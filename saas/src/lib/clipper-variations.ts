import 'server-only';
import {query,transaction,type DbClient} from './db';
import {AppError,audit,isUuid} from './core';
import {requireActiveWorkspace} from './products';
import {requireRole} from './workspaces';
import {scopedContent} from './content';
import {scopedJob,type ClipperInput,type ClipperVariationInput} from './job-core';
import {createQuote,lockWallet,canonicalHash} from './billing-core';
import {admitOperation} from './paid-operations';
import {variationRequest,variationRequestHash,VARIATION_POLICY} from './clipper-variation-core';
import {defaultVariationSettings,type VariationSettings} from './clipper-variation-settings';
import {objectStorage} from './storage';
import type {Clip} from './clipper-core';
import type {Session} from './auth';
type SavedVersion={id:string;content_item_id:string;artifact_id:string;job_id:string;sha256:string;transcript_artifact_id:string;plan_artifact_id:string;metadata:Record<string,unknown>};
type VariationRow={id:string;root_content_id:string;root_version_id:string;root_job_id:string;root_artifact_id:string;parent_variation_id:string|null;variation_number:number;settings_snapshot:VariationSettings;render_job_id:string;result_content_id:string|null;result_version_id:string|null};
async function version(db:DbClient,workspaceId:string,id:string,versionId:string){const r=(await db.query<SavedVersion>('SELECT * FROM content_versions WHERE workspace_id=$1 AND content_item_id=$2 AND id=$3',[workspaceId,id,versionId])).rows[0];if(!r)throw new AppError(404,'Clip version not found.');return r;}
async function availableArtifact(db:DbClient,workspaceId:string,jobId:string,id:string,expectedSlot?:string){
  const a=(await db.query<{id:string;sha256:string;storage_key:string;byte_size:string;slot_name:string;mime_type:string}>("SELECT a.* FROM job_artifacts a JOIN jobs j ON j.id=a.job_id AND j.workspace_id=a.workspace_id WHERE a.workspace_id=$1 AND a.job_id=$2 AND a.id=$3 AND a.status='READY' AND j.status='SUCCEEDED' AND j.result->'artifactIds' ? a.id::text AND NOT EXISTS(SELECT 1 FROM job_billing b WHERE b.job_id=j.id AND b.status='RELEASED')",[workspaceId,jobId,id])).rows[0];
  if(!a||expectedSlot&&a.slot_name!==expectedSlot||!a.sha256||!await objectStorage().head(a.storage_key))throw new AppError(409,'The saved source or editing data is unavailable.');return a;
}
export async function prepareVariation(db:DbClient,workspaceId:string,request:ReturnType<typeof variationRequest>):Promise<ClipperVariationInput>{
  const item=await scopedContent(db,workspaceId,request.sourceContentId);
  if(item.type!=='CLIP'||item.status==='ARCHIVED'||item.current_version_id!==request.sourceVersionId)throw new AppError(409,'Select the current version of an active clip.');
  const selected=await version(db,workspaceId,item.id,request.sourceVersionId);
  const depth=(await db.query<{n:number}>(`WITH RECURSIVE ancestors(id,depth) AS (SELECT $2::uuid,0 UNION ALL SELECT r.parent_content_id,a.depth+1 FROM ancestors a JOIN content_relations r ON r.content_item_id=a.id WHERE r.workspace_id=$1 AND r.relation_type='VARIANT_OF' AND a.depth<64) SELECT coalesce(max(depth),0)::int n FROM ancestors`,[workspaceId,item.id])).rows[0].n;
  if(depth>=64)throw new AppError(409,'This clip has reached its editing lineage limit.');
  const parent=(await db.query<VariationRow>('SELECT * FROM clipper_variations WHERE workspace_id=$1 AND result_content_id=$2 AND result_version_id=$3',[workspaceId,item.id,selected.id])).rows[0];
  const root=parent?await version(db,workspaceId,parent.root_content_id,parent.root_version_id):selected;
  const job=await scopedJob(db,workspaceId,root.job_id);
  if(job.type!=='CLIPPER'||job.status!=='SUCCEEDED'||job.input_snapshot.kind!=='CLIPPER'||!root.transcript_artifact_id||!root.plan_artifact_id)throw new AppError(409,'This clip does not have reusable editing data.');
  const original=job.input_snapshot as ClipperInput;
  const clip=(job.result?.clips as Clip[]|undefined)?.find(c=>c.artifactId===root.artifact_id);
  const source=(await db.query<{sha256:string;status:string;duration_seconds:number;byte_size:string;storage_key:string}>("SELECT sha256,status,duration_seconds,byte_size,storage_key FROM source_assets WHERE workspace_id=$1 AND id=$2",[workspaceId,original.source.sourceAssetId])).rows[0];
  if(!clip||!source||source.status!=='VERIFIED'||source.sha256!==root.metadata.sourceSha256||clip.start<0||clip.end>source.duration_seconds+.05||clip.duration<=0||clip.duration>90||source.storage_key!==original.source.storageKey||Number(source.byte_size)!==original.source.byteSize||!await objectStorage().head(source.storage_key))throw new AppError(409,'The original private source is unavailable for editing.');
  await availableArtifact(db,workspaceId,selected.job_id,selected.artifact_id);
  const transcript=await availableArtifact(db,workspaceId,root.job_id,root.transcript_artifact_id,'transcript');
  const plan=await availableArtifact(db,workspaceId,root.job_id,root.plan_artifact_id,'clip-plan');
  return {schemaVersion:1,kind:'CLIPPER_VARIATION',source:{...original.source,sha256:source.sha256},...(original.product?{product:original.product}:{}),language:original.language,goal:original.goal,targetClipCount:1,minClipSeconds:clip.duration,maxClipSeconds:clip.duration,aspectRatio:'9:16',captions:request.settings.subtitleEnabled,analyzerPolicyVersion:original.analyzerPolicyVersion,renderPolicyVersion:VARIATION_POLICY,variationPolicyVersion:VARIATION_POLICY,settings:request.settings,settingsHash:canonicalHash(request.settings),lineage:{sourceContentId:item.id,sourceVersionId:selected.id,sourceArtifactId:selected.artifact_id,rootContentId:root.content_item_id,rootVersionId:root.id,rootJobId:root.job_id,rootArtifactId:root.artifact_id,parentVariationId:parent?.id||null,transcriptArtifactId:transcript.id,transcriptSha256:transcript.sha256,planArtifactId:plan.id,planSha256:plan.sha256,clip}};
}
export async function quoteVariation(session:Session,workspaceId:string,raw:Record<string,unknown>){
  const request=variationRequest({...raw,idempotencyKey:raw.idempotencyKey||'quote-request'});await requireActiveWorkspace(session,workspaceId,'future:spend');
  return transaction(async db=>{await requireRole(session.userId,workspaceId,'future:spend',db);const input=await prepareVariation(db,workspaceId,request);return createQuote(db,workspaceId,session.userId,'CLIPPER_VARIATION',input,variationRequestHash(request));});
}
export async function createVariation(session:Session,workspaceId:string,raw:Record<string,unknown>){
  const request=variationRequest(raw),requestHash=variationRequestHash(request);await requireActiveWorkspace(session,workspaceId,'future:spend');
  return transaction(async db=>{
    await requireRole(session.userId,workspaceId,'future:spend',db);await lockWallet(db,workspaceId);
    const prior=(await db.query<{id:string;client_request_hash:string}>("SELECT id,client_request_hash FROM jobs WHERE workspace_id=$1 AND type='CLIPPER_VARIATION' AND idempotency_key=$2",[workspaceId,request.idempotencyKey])).rows[0];
    if(prior){if(prior.client_request_hash!==requestHash)throw new AppError(409,'Idempotency key was already used for different input.');return {id:prior.id,existing:true};}
    const input=await prepareVariation(db,workspaceId,request),l=input.lineage;
    await db.query('SELECT id FROM content_items WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,l.rootContentId]);
    const number=Number((await db.query<{n:number}>('SELECT coalesce(max(variation_number),0)+1 n FROM clipper_variations WHERE root_version_id=$1',[l.rootVersionId])).rows[0].n);
    if(number>10000)throw new AppError(409,'This clip has reached its variation limit.');
    const result=await admitOperation(db,{workspaceId,userId:session.userId,input,requestHash,key:request.idempotencyKey,quote:raw});
    await db.query(`INSERT INTO clipper_variations(workspace_id,source_content_id,source_version_id,source_artifact_id,root_content_id,root_version_id,root_artifact_id,root_job_id,parent_variation_id,variation_number,settings_snapshot,settings_hash,render_job_id,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,[workspaceId,l.sourceContentId,l.sourceVersionId,l.sourceArtifactId,l.rootContentId,l.rootVersionId,l.rootArtifactId,l.rootJobId,l.parentVariationId,number,JSON.stringify(input.settings),input.settingsHash,result.id,session.userId]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:'CLIPPER_VARIATION_CREATED',targetType:'job',targetId:result.id,metadata:{sourceContentId:l.sourceContentId,sourceVersionId:l.sourceVersionId,rootContentId:l.rootContentId,parentVariationId:l.parentVariationId,settingsHash:input.settingsHash,variationNumber:number}});
    return result;
  });
}
export async function variationEditor(session:Session,workspaceId:string,contentId:string){
  await requireActiveWorkspace(session,workspaceId,'workspace:read');const item=await scopedContent({query},workspaceId,contentId);
  const parent=(await query<VariationRow>('SELECT * FROM clipper_variations WHERE workspace_id=$1 AND result_content_id=$2 AND result_version_id=$3',[workspaceId,item.id,item.current_version_id])).rows[0];
  const settings=parent?{...parent.settings_snapshot,name:''}:{...defaultVariationSettings,name:''};
  const input=await prepareVariation({query},workspaceId,{sourceContentId:item.id,sourceVersionId:item.current_version_id,settings,idempotencyKey:'editor-request'});
  return {sourceContentId:item.id,sourceVersionId:item.current_version_id,title:item.title,rootContentId:input.lineage.rootContentId,hook:input.lineage.clip.hook,duration:input.lineage.clip.duration,settings,parentLabel:parent?`Variation ${parent.variation_number}`:'Original'};
}
export async function variationFamily(session:Session,workspaceId:string,contentId:string){
  await requireActiveWorkspace(session,workspaceId,'workspace:read');await scopedContent({query},workspaceId,contentId);
  const parent=(await query<VariationRow>('SELECT * FROM clipper_variations WHERE workspace_id=$1 AND result_content_id=$2',[workspaceId,contentId])).rows[0],root=parent?.root_content_id||contentId;
  const rows=(await query<{id:string;number:number;name:string;jobId:string;status:string;contentId:string|null;parentNumber:number|null}>(`SELECT v.id,v.variation_number AS number,v.settings_snapshot->>'name' AS name,v.render_job_id AS "jobId",CASE WHEN ci.status='ARCHIVED' THEN 'ARCHIVED' ELSE j.status END AS status,v.result_content_id AS "contentId",p.variation_number AS "parentNumber" FROM clipper_variations v JOIN jobs j ON j.workspace_id=v.workspace_id AND j.id=v.render_job_id LEFT JOIN content_items ci ON ci.workspace_id=v.workspace_id AND ci.id=v.result_content_id LEFT JOIN clipper_variations p ON p.workspace_id=v.workspace_id AND p.id=v.parent_variation_id WHERE v.workspace_id=$1 AND v.root_content_id=$2 ORDER BY v.variation_number LIMIT 100`,[workspaceId,root])).rows;
  return {rootContentId:root,variations:rows};
}
export async function clipEditorContent(workspaceId:string,jobId:string,artifactId:string){if(!isUuid(artifactId))return null;return (await query<{id:string}>('SELECT content_item_id id FROM content_versions WHERE workspace_id=$1 AND job_id=$2 AND artifact_id=$3',[workspaceId,jobId,artifactId])).rows[0]?.id||null;}
