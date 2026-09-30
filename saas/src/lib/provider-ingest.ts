import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { query, transaction } from "./db";
import { objectStorage } from "./storage";
import { ProviderSafeError, type ProviderPoll, type VideoProvider } from "./video-providers/types";

const execFileAsync=promisify(execFile);
export function maxGeneratedVideoBytes(){const value=Number(process.env.MAX_GENERATED_VIDEO_BYTES||268435456);return Number.isSafeInteger(value)?Math.max(1048576,Math.min(536870912,value)):268435456;}
async function probe(path:string){
  try{
    const {stdout}=await execFileAsync("ffprobe",["-v","error","-select_streams","v:0","-show_entries","stream=width,height:format=duration","-of","json",path],{timeout:10000,maxBuffer:16384});
    const parsed=JSON.parse(stdout) as {streams?:{width?:number;height?:number}[];format?:{duration?:string}};
    const duration=Number(parsed.format?.duration),width=parsed.streams?.[0]?.width,height=parsed.streams?.[0]?.height;
    return {durationSeconds:Number.isFinite(duration)&&duration>0?Math.round(duration*100)/100:null,width:typeof width==="number"&&width>0?width:null,height:typeof height==="number"&&height>0?height:null};
  }catch{return {durationSeconds:null,width:null,height:null};}
}
type Artifact={id:string;storage_key:string;status:string;byte_size:string|null;sha256:string|null;duration_seconds:string|null;width:number|null;height:number|null;expected_byte_size:string;expected_sha256:string|null};
export async function ingestProviderOutput(args:{provider:VideoProvider;poll:ProviderPoll;workspaceId:string;jobId:string;attemptId:string;ingestAttempt:number}){
  const existing=await query<Artifact>("SELECT id,storage_key,status,byte_size,sha256,duration_seconds,width,height,expected_byte_size,expected_sha256 FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2 AND attempt_id=$3 AND slot_name='video'",[args.workspaceId,args.jobId,args.attemptId]);
  if(existing.rows[0]?.status==="READY")return {artifactId:existing.rows[0].id,byteSize:Number(existing.rows[0].byte_size),sha256:existing.rows[0].sha256!,durationSeconds:existing.rows[0].duration_seconds?Number(existing.rows[0].duration_seconds):null,width:existing.rows[0].width,height:existing.rows[0].height};
  const retrieved=await args.provider.retrieve(args.poll,{ingestAttempt:args.ingestAttempt});
  if(!["video/mp4","application/octet-stream"].includes(retrieved.mimeType))throw new ProviderSafeError("OUTPUT_INVALID","The provider returned an unsupported video MIME type.");
  const maximum=maxGeneratedVideoBytes();
  if(retrieved.contentLength&&retrieved.contentLength>maximum)throw new ProviderSafeError("OUTPUT_INVALID","The generated video exceeds the allowed size.");
  const folder=await mkdtemp(join(tmpdir(),"saas-video-")),path=join(folder,"video.mp4");
  try{
    const file=await open(path,"w");let size=0;const hash=createHash("sha256");let header=Buffer.alloc(0);
    try{
      for await(const chunk of retrieved.stream){size+=chunk.length;if(size>maximum)throw new ProviderSafeError("OUTPUT_INVALID","The generated video exceeds the allowed size.");hash.update(chunk);if(header.length<16)header=Buffer.concat([header,Buffer.from(chunk)]).subarray(0,16);let offset=0;while(offset<chunk.length){const written=await file.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw new ProviderSafeError("OUTPUT_UNAVAILABLE","The video staging file could not be written.",true);offset+=written.bytesWritten;}}
    }finally{await file.close();}
    const checksum=hash.digest("hex");
    if(size<12||header.toString("ascii",4,8)!=="ftyp")throw new ProviderSafeError("OUTPUT_INVALID","The provider output is not an MP4 file.");
    if(retrieved.contentLength&&size!==retrieved.contentLength)throw new ProviderSafeError("OUTPUT_INVALID","The provider output size did not match.");
    if(retrieved.expectedSha256&&checksum!==retrieved.expectedSha256)throw new ProviderSafeError("OUTPUT_INVALID","The provider output checksum did not match.");
    const media=await probe(path);
    const artifact=await transaction(async db=>{
      const artifactId=randomUUID(),key=`workspaces/${args.workspaceId}/jobs/${args.jobId}/outputs/${artifactId}/video.mp4`;
      await db.query(`INSERT INTO job_artifacts(id,workspace_id,job_id,attempt_id,slot_name,storage_key,mime_type,expected_byte_size,expected_sha256)
        VALUES($1,$2,$3,$4,'video',$5,'video/mp4',$6,$7) ON CONFLICT(attempt_id,slot_name) DO NOTHING`,[artifactId,args.workspaceId,args.jobId,args.attemptId,key,size,checksum]);
      const found=await db.query<Artifact>("SELECT id,storage_key,status,byte_size,sha256,duration_seconds,width,height,expected_byte_size,expected_sha256 FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2 AND attempt_id=$3 AND slot_name='video' FOR UPDATE",[args.workspaceId,args.jobId,args.attemptId]);
      const row=found.rows[0];
      if(row.status==="PENDING"&&(Number(row.expected_byte_size)!==size||row.expected_sha256!==checksum))throw new ProviderSafeError("OUTPUT_INVALID","A previous output differs from this result.");
      return row;
    });
    if(artifact.status==="READY")return {artifactId:artifact.id,byteSize:Number(artifact.byte_size),sha256:artifact.sha256!,durationSeconds:artifact.duration_seconds?Number(artifact.duration_seconds):null,width:artifact.width,height:artifact.height};
    await objectStorage().putFile(artifact.storage_key,path,size,"video/mp4");
    const head=await objectStorage().head(artifact.storage_key);
    if(!head||head.byteSize!==size)throw new ProviderSafeError("OUTPUT_UNAVAILABLE","The stored video could not be verified.",true);
    await query("UPDATE job_artifacts SET status='READY',byte_size=$1,sha256=$2,duration_seconds=$3,width=$4,height=$5,verified_at=now() WHERE id=$6 AND status='PENDING'",[size,checksum,media.durationSeconds,media.width,media.height,artifact.id]);
    return {artifactId:artifact.id,byteSize:size,sha256:checksum,...media};
  }finally{await rm(path,{force:true}).catch(()=>{});await rmdir(folder).catch(()=>{});}
}
