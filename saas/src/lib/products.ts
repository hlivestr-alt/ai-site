import "server-only";
import { query, transaction, type DbClient } from "./db";
import { AppError, audit, isUuid } from "./core";
import { currentWorkspace, requireRole } from "./workspaces";
import type { Session } from "./auth";
import type { Permission } from "./permissions";

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type ProductFields = {brand:string;name:string;category:string;sku:string|null;description:string;keySellingPoints:string[];targetAudience:string};
export type RuleFields = {keepLogo:boolean;keepPackagingText:boolean;keepProductShape:boolean;keepCapPump:boolean;keepProductColorMaterial:boolean;keepApplicationMethod:boolean;customInstructions:string};

export async function requireActiveWorkspace(session: Session, workspaceId: string, permission: Permission, db?: DbClient) {
  const active = await currentWorkspace(session,db);
  if (!active || active.id !== workspaceId) throw new AppError(404,"Workspace not found.");
  return requireRole(session.userId,workspaceId,permission,db);
}

function bounded(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new AppError(400,`${label} must be ${min}–${max} characters.`);
  return value.trim();
}

export function productFields(value: Record<string,unknown>): ProductFields {
  const sku = value.sku == null || value.sku === "" ? null : bounded(value.sku,"SKU",1,80);
  if (!Array.isArray(value.keySellingPoints) || value.keySellingPoints.length>10) throw new AppError(400,"Provide up to 10 selling points.");
  const points=value.keySellingPoints.map(point=>bounded(point,"Selling point",1,200));
  return {
    brand:bounded(value.brand,"Brand",1,100), name:bounded(value.name,"Product name",2,160),
    category:bounded(value.category,"Category",1,100), sku,
    description:typeof value.description==="string"?bounded(value.description,"Description",0,3000):"",
    keySellingPoints:points,
    targetAudience:typeof value.targetAudience==="string"?bounded(value.targetAudience,"Target audience",0,1000):"",
  };
}

export function ruleFields(value: Record<string,unknown>): RuleFields {
  const keys=["keepLogo","keepPackagingText","keepProductShape","keepCapPump","keepProductColorMaterial","keepApplicationMethod"] as const;
  for (const key of keys) if (typeof value[key]!=="boolean") throw new AppError(400,`Invalid ${key} value.`);
  return {
    keepLogo:value.keepLogo as boolean, keepPackagingText:value.keepPackagingText as boolean,
    keepProductShape:value.keepProductShape as boolean, keepCapPump:value.keepCapPump as boolean,
    keepProductColorMaterial:value.keepProductColorMaterial as boolean, keepApplicationMethod:value.keepApplicationMethod as boolean,
    customInstructions:typeof value.customInstructions==="string"?bounded(value.customInstructions,"Instructions",0,3000):"",
  };
}

export const defaultRules: RuleFields={keepLogo:true,keepPackagingText:true,keepProductShape:true,keepCapPump:true,keepProductColorMaterial:true,keepApplicationMethod:true,customInstructions:""};

type ProductRow={id:string;workspace_id:string;status:ProductStatus;sku:string|null;current_version_id:string;current_rule_version_id:string;cover_asset_id:string|null;created_at:Date;updated_at:Date;archived_at:Date|null};
type ProductVersionRow={id:string;version_number:number;brand:string;name:string;category:string;sku:string|null;description:string;key_selling_points:string[];target_audience:string;created_at:Date};
type RulesRow={id:string;version_number:number;keep_logo:boolean;keep_packaging_text:boolean;keep_product_shape:boolean;keep_cap_pump:boolean;keep_product_color_material:boolean;keep_application_method:boolean;custom_instructions:string;created_at:Date};

async function scopedProduct(db:DbClient,workspaceId:string,productId:string,lock=false):Promise<ProductRow> {
  if(!isUuid(productId))throw new AppError(404,"Product not found.");
  const result=await db.query<ProductRow>(`SELECT * FROM products WHERE workspace_id=$1 AND id=$2 ${lock?"FOR UPDATE":""}`,[workspaceId,productId]);
  if(!result.rows[0])throw new AppError(404,"Product not found.");
  return result.rows[0];
}

export async function createProduct(session:Session,workspaceId:string,input:Record<string,unknown>) {
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  const fields=productFields(input);
  return transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:edit",db);
    const product=(await db.query<{id:string}>("INSERT INTO products(workspace_id,status,sku,created_by) VALUES($1,'DRAFT',$2,$3) RETURNING id",[workspaceId,fields.sku,session.userId])).rows[0];
    const version=(await db.query<{id:string}>(`INSERT INTO product_versions(workspace_id,product_id,version_number,brand,name,category,sku,description,key_selling_points,target_audience,created_by)
      VALUES($1,$2,1,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING id`,[workspaceId,product.id,fields.brand,fields.name,fields.category,fields.sku,fields.description,JSON.stringify(fields.keySellingPoints),fields.targetAudience,session.userId])).rows[0];
    const rules=(await db.query<{id:string}>(`INSERT INTO product_accuracy_rule_versions(workspace_id,product_id,version_number,created_by) VALUES($1,$2,1,$3) RETURNING id`,[workspaceId,product.id,session.userId])).rows[0];
    await db.query("UPDATE products SET current_version_id=$1,current_rule_version_id=$2 WHERE workspace_id=$3 AND id=$4",[version.id,rules.id,workspaceId,product.id]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:"PRODUCT_CREATED",targetType:"product",targetId:product.id});
    return {id:product.id,status:"DRAFT" as const,currentVersionId:version.id,currentRuleVersionId:rules.id};
  });
}

export async function updateProduct(session:Session,workspaceId:string,productId:string,input:Record<string,unknown>) {
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  const fields=productFields(input);
  return transaction(async db=>{
    const product=await scopedProduct(db,workspaceId,productId,true);
    await requireRole(session.userId,workspaceId,"future:edit",db);
    if(product.status==="ARCHIVED")throw new AppError(409,"Archived products cannot be edited.");
    const version=(await db.query<{id:string;version_number:number}>(`INSERT INTO product_versions(workspace_id,product_id,version_number,brand,name,category,sku,description,key_selling_points,target_audience,created_by)
      SELECT $1,$2,coalesce(max(version_number),0)+1,$3,$4,$5,$6,$7,$8::jsonb,$9,$10 FROM product_versions WHERE workspace_id=$1 AND product_id=$2 RETURNING id,version_number`,[workspaceId,productId,fields.brand,fields.name,fields.category,fields.sku,fields.description,JSON.stringify(fields.keySellingPoints),fields.targetAudience,session.userId])).rows[0];
    await db.query("UPDATE products SET current_version_id=$1,sku=$2,updated_at=now() WHERE workspace_id=$3 AND id=$4",[version.id,fields.sku,workspaceId,productId]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:"PRODUCT_UPDATED",targetType:"product",targetId:productId,metadata:{version:version.version_number}});
    return version;
  });
}

export async function updateProductRules(session:Session,workspaceId:string,productId:string,input:Record<string,unknown>) {
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  const fields=ruleFields(input);
  return transaction(async db=>{
    const product=await scopedProduct(db,workspaceId,productId,true);
    await requireRole(session.userId,workspaceId,"future:edit",db);
    if(product.status==="ARCHIVED")throw new AppError(409,"Archived products cannot be edited.");
    const version=(await db.query<{id:string;version_number:number}>(`INSERT INTO product_accuracy_rule_versions(workspace_id,product_id,version_number,keep_logo,keep_packaging_text,keep_product_shape,keep_cap_pump,keep_product_color_material,keep_application_method,custom_instructions,created_by)
      SELECT $1,$2,coalesce(max(version_number),0)+1,$3,$4,$5,$6,$7,$8,$9,$10 FROM product_accuracy_rule_versions WHERE workspace_id=$1 AND product_id=$2 RETURNING id,version_number`,[workspaceId,productId,fields.keepLogo,fields.keepPackagingText,fields.keepProductShape,fields.keepCapPump,fields.keepProductColorMaterial,fields.keepApplicationMethod,fields.customInstructions,session.userId])).rows[0];
    await db.query("UPDATE products SET current_rule_version_id=$1,updated_at=now() WHERE workspace_id=$2 AND id=$3",[version.id,workspaceId,productId]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:"PRODUCT_RULES_UPDATED",targetType:"product",targetId:productId,metadata:{version:version.version_number}});
    return version;
  });
}

export async function activateProduct(session:Session,workspaceId:string,productId:string) {
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  return transaction(async db=>{
    const product=await scopedProduct(db,workspaceId,productId,true);
    await requireRole(session.userId,workspaceId,"future:edit",db);
    if(product.status!=="DRAFT")throw new AppError(409,"Only a draft can be activated.");
    const count=await db.query<{count:string}>("SELECT count(*) FROM assets WHERE workspace_id=$1 AND product_id=$2 AND status='READY'",[workspaceId,productId]);
    if(Number(count.rows[0].count)<1)throw new AppError(409,"Upload at least one reference asset before saving the product.");
    await db.query("UPDATE products SET status='ACTIVE',updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspaceId,productId]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:"PRODUCT_ACTIVATED",targetType:"product",targetId:productId});
    return {id:productId,status:"ACTIVE" as const};
  });
}

export async function archiveProduct(session:Session,workspaceId:string,productId:string) {
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  return transaction(async db=>{
    const product=await scopedProduct(db,workspaceId,productId,true);
    await requireRole(session.userId,workspaceId,"future:edit",db);
    if(product.status==="ARCHIVED")return {id:productId,status:"ARCHIVED" as const};
    await db.query("UPDATE products SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspaceId,productId]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:"PRODUCT_ARCHIVED",targetType:"product",targetId:productId});
    return {id:productId,status:"ARCHIVED" as const};
  });
}

export async function listProducts(session:Session,workspaceId:string,options:{search?:string;status?:string;page?:number;pageSize?:number}={}) {
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  const status=options.status||"CURRENT";
  if(!["CURRENT","ACTIVE","DRAFT","ARCHIVED"].includes(status))throw new AppError(400,"Invalid status filter.");
  const page=Math.max(1,Math.min(500,Math.trunc(options.page||1)));
  const pageSize=Math.max(1,Math.min(50,Math.trunc(options.pageSize||20)));
  const search=(options.search||"").trim().slice(0,100);
  const pattern=`%${search.replace(/[\\%_]/g,"\\$&")}%`;
  const where=`p.workspace_id=$1 AND (($2='CURRENT' AND p.status<>'ARCHIVED') OR p.status=$2) AND ($3='' OR v.name ILIKE $4 ESCAPE '\\' OR v.brand ILIKE $4 ESCAPE '\\' OR coalesce(v.sku,'') ILIKE $4 ESCAPE '\\')`;
  const values=[workspaceId,status,search,pattern];
  const [rows,count]=await Promise.all([
    query<{id:string;status:ProductStatus;sku:string|null;updated_at:Date;version_number:number;brand:string;name:string;category:string;asset_count:string}>(`SELECT p.id,p.status,p.sku,p.updated_at,v.version_number,v.brand,v.name,v.category,
      (SELECT count(*) FROM assets a WHERE a.workspace_id=p.workspace_id AND a.product_id=p.id AND a.status='READY') AS asset_count
      FROM products p JOIN product_versions v ON v.id=p.current_version_id AND v.workspace_id=p.workspace_id AND v.product_id=p.id
      WHERE ${where} ORDER BY p.updated_at DESC,p.id DESC LIMIT $5 OFFSET $6`,[...values,pageSize,(page-1)*pageSize]),
    query<{count:string}>(`SELECT count(*) FROM products p JOIN product_versions v ON v.id=p.current_version_id AND v.workspace_id=p.workspace_id AND v.product_id=p.id WHERE ${where}`,values),
  ]);
  const covers=await productCovers({query},workspaceId,rows.rows.map(p=>p.id));
  return {products:rows.rows.map(p=>({...p,cover:covers.find(c=>c.product_id===p.id)||null})),total:Number(count.rows[0].count),page,pageSize};
}

export async function productCounts(session:Session,workspaceId:string) {
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  const result=await query<{products:string;assets:string}>(`SELECT
    (SELECT count(*) FROM products WHERE workspace_id=$1 AND status='ACTIVE') AS products,
    (SELECT count(*) FROM assets WHERE workspace_id=$1 AND status='READY') AS assets`,[workspaceId]);
  return {products:Number(result.rows[0].products),assets:Number(result.rows[0].assets)};
}

export async function getProductSnapshot(session:Session,workspaceId:string,productId:string,db?:DbClient) {
  await requireActiveWorkspace(session,workspaceId,"workspace:read",db);
  const client=db??{query};
  const product=await scopedProduct(client,workspaceId,productId,!!db);
  const version=await client.query<ProductVersionRow>("SELECT * FROM product_versions WHERE workspace_id=$1 AND product_id=$2 AND id=$3",[workspaceId,productId,product.current_version_id]);
  const rules=await client.query<RulesRow>("SELECT * FROM product_accuracy_rule_versions WHERE workspace_id=$1 AND product_id=$2 AND id=$3",[workspaceId,productId,product.current_rule_version_id]);
  const assets=await client.query<{id:string;purpose:string;type:string;version_id:string;version_number:number;storage_key:string;sha256:string;byte_size:string;mime_type:string;thumbnail_key:string|null;width:number|null;height:number|null}>(`SELECT a.id,a.purpose,a.type,v.id AS version_id,v.version_number,v.storage_key,v.sha256,v.byte_size,v.mime_type,v.thumbnail_key,v.width,v.height
      FROM assets a JOIN asset_versions v ON v.id=a.current_version_id AND v.workspace_id=a.workspace_id AND v.product_id=a.product_id AND v.asset_id=a.id
      WHERE a.workspace_id=$1 AND a.product_id=$2 AND a.status='READY' AND v.status='READY' AND EXISTS(SELECT 1 FROM product_reference_slots s WHERE s.workspace_id=a.workspace_id AND s.product_id=a.product_id AND s.asset_id=a.id) ORDER BY a.created_at,a.id LIMIT 100`,[workspaceId,productId]);
  if(!version.rows[0]||!rules.rows[0])throw new AppError(500,"Product snapshot is incomplete.");
  return {product:{id:product.id,workspaceId:product.workspace_id,status:product.status,coverAssetId:product.cover_asset_id},version:version.rows[0],rules:rules.rows[0],assets:assets.rows};
}

export async function getProductDetail(session:Session,workspaceId:string,productId:string) {
  const snapshot=await getProductSnapshot(session,workspaceId,productId);
  const [versions,ruleVersions,assets]=await Promise.all([
    query<ProductVersionRow>("SELECT * FROM product_versions WHERE workspace_id=$1 AND product_id=$2 ORDER BY version_number DESC LIMIT 50",[workspaceId,productId]),
    query<RulesRow>("SELECT * FROM product_accuracy_rule_versions WHERE workspace_id=$1 AND product_id=$2 ORDER BY version_number DESC LIMIT 50",[workspaceId,productId]),
    query<{id:string;purpose:string;slot:string;type:"IMAGE"|"VIDEO";status:string;current_version_id:string|null;original_filename:string|null;version_number:number|null;byte_size:string|null;mime_type:string|null;thumbnail_key:string|null}>(`SELECT a.id,a.purpose,s.slot,a.type,a.status,a.current_version_id,v.original_filename,v.version_number,v.byte_size,v.mime_type,v.thumbnail_key
      FROM assets a LEFT JOIN asset_versions v ON v.id=a.current_version_id AND v.workspace_id=a.workspace_id AND v.product_id=a.product_id AND v.asset_id=a.id
      JOIN product_reference_slots s ON s.workspace_id=a.workspace_id AND s.product_id=a.product_id AND s.asset_id=a.id
      WHERE a.workspace_id=$1 AND a.product_id=$2 AND a.status='READY' ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,[workspaceId,productId]),
  ]);
  const cover=(await productCovers({query},workspaceId,[productId]))[0]||null;
  const pendingUploads=(await query<{assetId:string;versionId:string;slot:string}>(`SELECT asset_id AS "assetId",id AS "versionId",reference_slot AS slot FROM asset_versions WHERE workspace_id=$1 AND product_id=$2 AND status='PENDING_UPLOAD' AND reference_slot IS NOT NULL ORDER BY created_at LIMIT 8`,[workspaceId,productId])).rows;
  return {...snapshot,cover,pendingUploads,versionHistory:versions.rows,ruleHistory:ruleVersions.rows,assets:assets.rows};
}

async function productCovers(db:DbClient,workspaceId:string,productIds:string[]){
  return (await db.query<{product_id:string;asset_id:string;version_id:string}>(`SELECT DISTINCT ON(a.product_id) a.product_id,a.id AS asset_id,v.id AS version_id
    FROM assets a JOIN asset_versions v ON v.workspace_id=a.workspace_id AND v.product_id=a.product_id AND v.asset_id=a.id AND v.id=a.current_version_id
    JOIN products p ON p.workspace_id=a.workspace_id AND p.id=a.product_id
    JOIN product_reference_slots s ON s.workspace_id=a.workspace_id AND s.product_id=a.product_id AND s.asset_id=a.id
    WHERE a.workspace_id=$1 AND a.product_id=ANY($2::uuid[]) AND a.status='READY' AND a.type='IMAGE' AND v.status='READY'
    ORDER BY a.product_id,(p.cover_asset_id=a.id) DESC NULLS LAST,(s.slot='FRONT') DESC,s.slot,a.id`,[workspaceId,productIds])).rows;
}

export async function setProductCover(session:Session,workspaceId:string,productId:string,assetId:unknown){
  await requireActiveWorkspace(session,workspaceId,'future:edit');
  if(typeof assetId!=='string'||!isUuid(assetId))throw new AppError(404,'Reference not found.');
  return transaction(async db=>{
    const product=await scopedProduct(db,workspaceId,productId,true);await requireRole(session.userId,workspaceId,'future:edit',db);
    if(product.status==='ARCHIVED')throw new AppError(409,'Restore this product before editing it.');
    const ready=await db.query("SELECT 1 FROM assets a JOIN asset_versions v ON v.id=a.current_version_id AND v.workspace_id=a.workspace_id AND v.product_id=a.product_id AND v.asset_id=a.id JOIN product_reference_slots s ON s.workspace_id=a.workspace_id AND s.product_id=a.product_id AND s.asset_id=a.id WHERE a.workspace_id=$1 AND a.product_id=$2 AND a.id=$3 AND a.status='READY' AND a.type='IMAGE' AND v.status='READY'",[workspaceId,productId,assetId]);
    if(!ready.rows.length)throw new AppError(404,'Current image reference not found.');
    await db.query('UPDATE products SET cover_asset_id=$1,updated_at=now() WHERE workspace_id=$2 AND id=$3',[assetId,workspaceId,productId]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:'PRODUCT_COVER_SELECTED',targetType:'product',targetId:productId});return {coverAssetId:assetId};
  });
}

export async function restoreProduct(session:Session,workspaceId:string,productId:string){
  await requireActiveWorkspace(session,workspaceId,'future:edit');
  return transaction(async db=>{
    const product=await scopedProduct(db,workspaceId,productId,true);await requireRole(session.userId,workspaceId,'future:edit',db);
    if(product.status!=='ARCHIVED')throw new AppError(409,'Only an archived product can be restored.');
    const duplicate=await db.query("SELECT 1 FROM products WHERE workspace_id=$1 AND sku=$2 AND status='ACTIVE' AND id<>$3",[workspaceId,product.sku,productId]);
    if(duplicate.rows.length)throw new AppError(409,'Another active product uses this SKU. Update that product before restoring.');
    await db.query("UPDATE products SET status='ACTIVE',archived_at=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspaceId,productId]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:'PRODUCT_RESTORED',targetType:'product',targetId:productId});return {id:productId,status:'ACTIVE' as const};
  });
}
