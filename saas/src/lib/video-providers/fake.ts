import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiVideoInput } from "../job-core";
import { ProviderSafeError, SubmissionUnknownError, type PollContext, type ProviderCapabilities, type ProviderPoll, type RetrieveContext, type VideoProvider } from "./types";

const capabilities:ProviderCapabilities={minDurationSeconds:4,maxDurationSeconds:30,aspectRatios:["9:16","16:9","1:1"],maxReferenceImages:4,maxQuantity:1};
export class FakeVideoProvider implements VideoProvider {
  readonly name="FAKE" as const;
  capabilities(){return capabilities;}
  validateInput(input:AiVideoInput){
    if(input.durationSeconds<4||input.durationSeconds>30||!capabilities.aspectRatios.includes(input.aspectRatio)||input.quantity!==1||input.referenceAssetVersionIds.length>4)throw new ProviderSafeError("INVALID_INPUT","This video request is not supported.");
  }
  async submit(input:AiVideoInput,_model:string,context:{submissionToken:string;attemptNumber:number}){
    if(input.testScenario==="RATE_LIMIT"&&context.attemptNumber===1)throw new ProviderSafeError("PROVIDER_RATE_LIMIT","The provider is busy. Retrying shortly.",true);
    if(input.testScenario==="SUBMISSION_UNKNOWN")throw new SubmissionUnknownError();
    return {externalTaskId:`fake-${context.submissionToken}`};
  }
  async findBySubmissionToken(token:string){return `fake-${token}`;}
  async poll(externalTaskId:string,context:PollContext):Promise<ProviderPoll>{
    if(!/^fake-[0-9a-f-]{36}$/.test(externalTaskId))throw new ProviderSafeError("PROVIDER_REJECTED","Provider task was not found.");
    const age=Date.now()-context.submittedAt.getTime();
    if(age<300)return {status:"queued"};
    if(age<600)return {status:"running"};
    if(context.testScenario==="FAILURE")return {status:"failed",errorCode:"FAKE_FAILURE"};
    return {status:"succeeded",outputUrl:`fake://${externalTaskId}`};
  }
  async cancel(){return true;}
  async retrieve(poll:ProviderPoll,context:RetrieveContext){
    if(!poll.outputUrl?.startsWith("fake://"))throw new ProviderSafeError("OUTPUT_UNAVAILABLE","The video output is unavailable.",true);
    const scenario=(poll as ProviderPoll&{testScenario?:string}).testScenario;
    if(scenario==="DOWNLOAD_FAIL_ONCE"&&context.ingestAttempt===1)throw new ProviderSafeError("OUTPUT_UNAVAILABLE","The video download is temporarily unavailable.",true);
    const bytes=await readFile(join(process.cwd(),"tests","fixtures","fake-video.mp4"));
    return {stream:(async function*(){yield bytes;})(),mimeType:scenario==="INVALID_MIME"?"image/png":"video/mp4",contentLength:scenario==="OVERSIZED_OUTPUT"?536870913:bytes.length,expectedSha256:scenario==="INVALID_CHECKSUM"?"0".repeat(64):undefined};
  }
  normalizeProgress(poll:ProviderPoll){return poll.status==="queued"?{percent:10,stage:"provider_queued",message:"Queued with video provider"}:poll.status==="running"?{percent:40,stage:"generating",message:"Generating video"}:{percent:80,stage:"finalizing",message:"Preparing video output"};}
  mapError(error:unknown){return error instanceof ProviderSafeError||error instanceof SubmissionUnknownError?error:new ProviderSafeError("INTERNAL_ERROR","Video processing could not continue.");}
}
