import {randomUUID} from "node:crypto";
import {query,transaction,type DbClient} from "./db";
import {audit,AppError} from "./core";
import {scopedJob,type JobRow,type AiVideoInput,type ClipperInput} from "./job-core";
import {validatedClips} from "./clipper-core";
import {objectStorage} from "./storage";

type Artifact={id:string;attempt_id:string;slot_name:string;mime_type:string;status:string;storage_key:string;byte_size:string;sha256:string;duration_seconds:string|null;width:number|null;height:number|null};
async function jsonArtifact(a:Artifact,maximum:number){let size=0;const chunks:Buffer[]=[];for await(const chunk of await objectStorage().stream(a.storage_key)){size+=chunk.length;if(size>maximum)throw new AppError(422,"Lineage artifact exceeds its limit.");chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string,unknown>;}
async function publish(db:DbClient,job:JobRow){
  if(job.status!=="SUCCEEDED"||!["AI_VIDEO","CLIPPER"].includes(job.type)||!job.result||!["AI_VIDEO","CLIPPER"].includes(job.input_snapshot.kind||""))throw new AppError(422,"Only successful supported jobs publish Content.");
  if((await db.query("SELECT job_id FROM job_billing WHERE workspace_id=$1 AND job_id=$2 AND status='RELEASED'",[job.workspace_id,job.id])).rowCount)throw new AppError(409,"Late success is quarantined for billing reconciliation.");
  const input=job.input_snapshot as AiVideoInput|ClipperInput,result=job.result;
  const ids=result.artifactIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>12||new Set(ids).size!==ids.length)throw new AppError(422,"Invalid publication artifacts.");
  const artifacts=(await db.query<Artifact>(`SELECT a.* FROM job_artifacts a JOIN job_attempts t ON t.id=a.attempt_id AND t.workspace_id=a.workspace_id AND t.job_id=a.job_id
    WHERE a.workspace_id=$1 AND a.job_id=$2 AND a.id=ANY($3::uuid[]) AND a.status='READY' AND t.status='SUCCEEDED' AND t.attempt_number=$4`,[job.workspace_id,job.id,ids,job.attempt_count])).rows;
  if(artifacts.length!==ids.length||artifacts.some(a=>!a.sha256||!a.byte_size))throw new AppError(422,"Publication requires current successful READY artifacts.");
  let plan:Record<string,unknown>={},transcript:Record<string,unknown>={},clips:ReturnType<typeof validatedClips>=[],sourceSha:string|null=null;
  if(input.kind==="CLIPPER"){
    const source=(await db.query<{sha256:string;status:string}>("SELECT sha256,status FROM source_assets WHERE workspace_id=$1 AND id=$2",[job.workspace_id,input.source.sourceAssetId])).rows[0];
    if(!source?.sha256||!["VERIFIED","ARCHIVED"].includes(source.status)||result.sourceAssetId!==input.source.sourceAssetId||source.sha256!==result.sourceSha256)throw new AppError(422,"Source lineage is unavailable.");
    sourceSha=source.sha256;
    const t=artifacts.find(a=>a.id===result.transcriptArtifactId&&a.slot_name==="transcript"&&a.mime_type==="application/json"),p=artifacts.find(a=>a.id===result.planArtifactId&&a.slot_name==="clip-plan"&&a.mime_type==="application/json");
    if(!t||!p)throw new AppError(422,"Clip support artifacts are unavailable.");
    plan=await jsonArtifact(p,20971520);transcript=await jsonArtifact(t,67108864);
    if(plan.inputHash!==job.input_hash||plan.transcriptArtifactId!==t.id||plan.sourceSha256!==sourceSha||transcript.sourceSha256!==sourceSha)throw new AppError(422,"Clip lineage differs from execution.");
    clips=validatedClips(result.clips,input,Number(transcript.duration));
    if(artifacts.length!==clips.length+2||!Array.isArray(plan.clips)||plan.clips.length!==clips.length)throw new AppError(422,"Clip publication manifest is incomplete.");
  }
  const media=input.kind==="AI_VIDEO"?artifacts:clips.map(c=>artifacts.find(a=>a.id===c.artifactId)!);
  if(input.kind==="AI_VIDEO"&&(media.length!==1||media[0].slot_name!=="video"))throw new AppError(422,"AI Video publishes one video.");
  const contentIds:string[]=[];
  for(let index=0;index<media.length;index++){
    const a=media[index],clip=clips[index];
    if(!a||a.mime_type!=="video/mp4"||input.kind==="CLIPPER"&&(a.slot_name!==`clip_${String(index+1).padStart(3,"0")}`||a.sha256!==clip.sha256))throw new AppError(422,"Invalid publication video.");
    if(clip){const planned=(plan.clips as Record<string,unknown>[])[index];if(["start","end","score","hook","reason","tags"].some(k=>JSON.stringify(planned[k])!==JSON.stringify(clip[k as keyof typeof clip])))throw new AppError(422,"Clip selection differs from sealed plan.");}
    const prior=(await db.query<{content_item_id:string}>("SELECT content_item_id FROM content_versions WHERE workspace_id=$1 AND artifact_id=$2",[job.workspace_id,a.id])).rows[0];
    if(prior){contentIds.push(prior.content_item_id);continue;}
    const id=randomUUID(),versionId=randomUUID(),product=input.product;
    const productName=product?String(product.information.name).slice(0,160):null;
    const title=clip?clip.hook:`${productName||"Generated"} video`;
    const sourceId=input.kind==="CLIPPER"?input.source.sourceAssetId:null;
    const metadata=input.kind==="AI_VIDEO"?{schemaVersion:1,providerPolicyVersion:input.providerPolicyVersion,tier:input.tier,aspectRatio:input.aspectRatio,referenceAssetVersionIds:input.referenceAssetVersionIds,inputHash:job.input_hash}:
      {schemaVersion:1,inputHash:job.input_hash,sourceSha256:sourceSha,start:clip.start,end:clip.end,hook:clip.hook,reason:clip.reason,score:clip.score,tags:clip.tags,clipNumber:index+1,analyzerPolicyVersion:input.analyzerPolicyVersion,renderPolicyVersion:input.renderPolicyVersion,pipelineVersion:result.pipelineVersion,transcriptFingerprint:plan.transcriptFingerprint||(transcript.metadata as Record<string,unknown>|undefined)?.fingerprint||null,analyzerProvider:plan.analyzerProvider||input.analyzerProvider,analyzerModels:plan.analyzerModels||[],analyzerUsage:plan.usage||{}};
    if(Buffer.byteLength(JSON.stringify(metadata))>32768)throw new AppError(422,"Content metadata exceeds its limit.");
    await db.query("INSERT INTO content_items(id,workspace_id,type,title,product_name,source_filename,product_id,source_asset_id,origin_job_id,created_by) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,created_by FROM jobs WHERE id=$9",[id,job.workspace_id,input.kind==="AI_VIDEO"?"AI_VIDEO":"CLIP",title,productName,input.kind==="CLIPPER"?input.source.filename:null,product?.id||null,sourceId,job.id]);
    await db.query(`INSERT INTO content_versions(id,workspace_id,content_item_id,version_number,artifact_id,job_id,mime_type,byte_size,sha256,duration_seconds,width,height,product_id,product_version_id,product_rule_version_id,source_asset_id,transcript_artifact_id,plan_artifact_id,metadata)
      VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,[versionId,job.workspace_id,id,a.id,job.id,a.mime_type,a.byte_size,a.sha256,a.duration_seconds,a.width,a.height,product?.id||null,product?.versionId||null,product?.ruleVersionId||null,sourceId,input.kind==="CLIPPER"?result.transcriptArtifactId:null,input.kind==="CLIPPER"?result.planArtifactId:null,JSON.stringify(metadata)]);
    await db.query("UPDATE content_items SET current_version_id=$1 WHERE id=$2",[versionId,id]);
    await db.query("INSERT INTO content_relations(workspace_id,content_item_id,relation_type,source_asset_id,job_id) VALUES($1,$2,$3,$4,$5)",[job.workspace_id,id,sourceId?"CLIPPED_FROM":"GENERATED_FROM",sourceId,sourceId?null:job.id]);
    if(input.kind==="AI_VIDEO")for(const reference of input.product.assets.filter(a=>input.referenceAssetVersionIds.includes(a.assetVersionId))){await db.query("INSERT INTO content_reference_assets(workspace_id,content_item_id,content_version_id,product_id,asset_id,asset_version_id,purpose) VALUES($1,$2,$3,$4,$5,$6,$7)",[job.workspace_id,id,versionId,input.product.id,reference.assetId,reference.assetVersionId,reference.purpose]);}
    await db.query("INSERT INTO content_posters(workspace_id,content_item_id,content_version_id) VALUES($1,$2,$3)",[job.workspace_id,id,versionId]);
    await audit(db,{workspaceId:job.workspace_id,type:"CONTENT_PUBLISHED",targetType:"content",targetId:id,metadata:{jobId:job.id,artifactId:a.id,versionId}});
    contentIds.push(id);
  }
  return contentIds;
}
async function processPublication(db:DbClient,row:{workspace_id:string;job_id:string;status:string}){
  const job=await scopedJob(db,row.workspace_id,row.job_id,true);
  const ids=await publish(db,job);
  await db.query("UPDATE content_publications SET status='PUBLISHED',published_at=coalesce(published_at,now()),last_error_code=NULL WHERE job_id=$1",[job.id]);
  return ids;
}
// Server/system helper only. There is no customer publication endpoint.
export async function publishJobContent(workspaceId:string,jobId:string){return transaction(async db=>{
  const row=(await db.query<{workspace_id:string;job_id:string;status:string}>("SELECT * FROM content_publications WHERE workspace_id=$1 AND job_id=$2 FOR UPDATE",[workspaceId,jobId])).rows[0];
  if(!row)throw new AppError(404,"Publication intent not found.");return processPublication(db,row);
});}
export async function contentPublicationBatch(limit=10){let processed=0;for(let index=0;index<limit;index++){
  let jobId:string|undefined;
  try{const found=await transaction(async db=>{const row=(await db.query<{workspace_id:string;job_id:string;status:string}>("SELECT * FROM content_publications WHERE status='PENDING' AND available_at<=now() ORDER BY available_at,job_id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];if(!row)return false;jobId=row.job_id;await processPublication(db,row);return true;});if(!found)break;processed++;}
  catch(error){if(!jobId)throw error;await query("UPDATE content_publications SET attempts=attempts+1,last_error_code=$1,available_at=now()+least(300,5*power(2,least(attempts,6))) * interval '1 second' WHERE job_id=$2 AND status='PENDING'",[error instanceof AppError?"PUBLICATION_INVALID":"PUBLICATION_RETRY",jobId]);}
}return processed;}
