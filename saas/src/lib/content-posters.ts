import {createHash} from "node:crypto";
import {mkdtemp,open,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {query,transaction} from "./db";
import {objectStorage} from "./storage";
type PosterTask={workspace_id:string;content_item_id:string;content_version_id:string;attempts:number;storage_key:string;byte_size:string;sha256:string;duration_seconds:string|null};
async function poster(task:PosterTask){
  const folder=await mkdtemp(join(tmpdir(),"saas-poster-")),path=join(folder,"input.mp4"),output=join(folder,"poster.jpg");
  try{
    const file=await open(path,"wx"),hash=createHash("sha256");let bytes=0;const deadline=Date.now()+120000;
    try{for await(const chunk of await objectStorage().stream(task.storage_key)){bytes+=chunk.length;if(bytes>536870912||bytes>Number(task.byte_size)||Date.now()>deadline)throw new Error("POSTER_INPUT_BOUND");hash.update(chunk);let offset=0;while(offset<chunk.length){const written=await file.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw new Error("POSTER_WRITE");offset+=written.bytesWritten;}}}finally{await file.close();}
    if(bytes!==Number(task.byte_size)||hash.digest("hex")!==task.sha256)throw new Error("POSTER_INPUT_IDENTITY");
    await promisify(execFile)(process.env.FFMPEG_PATH||"ffmpeg",["-hide_banner","-loglevel","error","-ss",String(Math.min(1,Number(task.duration_seconds||2)/2)),"-i",path,"-frames:v","1","-vf","scale=480:480:force_original_aspect_ratio=decrease","-q:v","4","-threads","1","-y",output],{timeout:15000,maxBuffer:16384,windowsHide:true});
    const image=await readFile(output);if(image.length<4||image.length>1048576||image[0]!==255||image[1]!==216)throw new Error("POSTER_OUTPUT_BOUND");
    const key=`workspaces/${task.workspace_id}/content/${task.content_item_id}/versions/${task.content_version_id}/poster-${task.attempts}.jpg`,sha256=createHash("sha256").update(image).digest("hex");
    await objectStorage().put(key,image,"image/jpeg");const head=await objectStorage().head(key);if(head?.byteSize!==image.length)throw new Error("POSTER_STORAGE");
    await query("UPDATE content_posters SET status='READY',storage_key=$1,mime_type='image/jpeg',byte_size=$2,sha256=$3,last_error_code=NULL WHERE content_version_id=$4 AND status='PROCESSING' AND attempts=$5",[key,image.length,sha256,task.content_version_id,task.attempts]);
  }finally{await rm(folder,{recursive:true,force:true});}
}
export async function contentPosterBatch(limit=2,versionId?:string){let processed=0;await query("UPDATE content_posters SET status='FAILED',last_error_code='POSTER_UNAVAILABLE' WHERE status='PROCESSING' AND available_at<=now() AND attempts>=3");
  for(let index=0;index<limit;index++){
    const task=await transaction(async db=>{
      const r=await db.query<PosterTask>(`SELECT p.workspace_id,p.content_item_id,p.content_version_id,p.attempts,a.storage_key,v.byte_size,v.sha256,v.duration_seconds FROM content_posters p
        JOIN content_versions v ON v.id=p.content_version_id AND v.workspace_id=p.workspace_id AND v.content_item_id=p.content_item_id
        JOIN job_artifacts a ON a.id=v.artifact_id AND a.workspace_id=v.workspace_id AND a.job_id=v.job_id
        WHERE p.status IN ('PENDING','PROCESSING') AND p.available_at<=now() AND p.attempts<3 AND ($1::uuid IS NULL OR p.content_version_id=$1) ORDER BY p.available_at,p.content_version_id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`,[versionId||null]);
      if(!r.rows[0])return null;const row=r.rows[0];row.attempts++;
      await db.query("UPDATE content_posters SET status='PROCESSING',attempts=$1,available_at=now()+interval '3 minutes' WHERE content_version_id=$2",[row.attempts,row.content_version_id]);return row;
    });
    if(!task)break;
    try{await poster(task);processed++;}catch{await query("UPDATE content_posters SET status=CASE WHEN attempts>=3 THEN 'FAILED' ELSE 'PENDING' END,last_error_code='POSTER_UNAVAILABLE',available_at=now()+interval '30 seconds' WHERE content_version_id=$1 AND status='PROCESSING' AND attempts=$2",[task.content_version_id,task.attempts]);}
  }return processed;
}
