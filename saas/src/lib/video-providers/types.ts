import type { AiVideoInput } from "../job-core";

export type ProviderName="BYTEPLUS"|"WAVESPEED"|"FAKE";
export type ProviderStatus="queued"|"running"|"succeeded"|"failed"|"cancelled";
export type ProviderCapabilities={minDurationSeconds:number;maxDurationSeconds:number;aspectRatios:string[];maxReferenceImages:number;maxQuantity:number};
export type SubmissionContext={submissionToken:string;attemptNumber:number};
export type PollContext={submittedAt:Date;attemptNumber:number;testScenario?:AiVideoInput["testScenario"]};
export type RetrieveContext={ingestAttempt:number};
export type ProviderPoll={status:ProviderStatus;outputUrl?:string;errorCode?:string;usage?:{completionTokens?:number};durationSeconds?:number;width?:number;height?:number};
export type RetrievedVideo={stream:AsyncIterable<Uint8Array>;mimeType:string;contentLength?:number;expectedSha256?:string};

export class SubmissionUnknownError extends Error {constructor(){super("Submission outcome is unknown");this.name="SubmissionUnknownError";}}
export class ProviderSafeError extends Error {
  constructor(public code:string,public safeMessage:string,public retryable=false){super(safeMessage);this.name="ProviderSafeError";}
}
export interface VideoProvider {
  readonly name:ProviderName;
  capabilities():ProviderCapabilities;
  validateInput(input:AiVideoInput):void;
  submit(input:AiVideoInput,model:string,context:SubmissionContext):Promise<{externalTaskId:string}>;
  findBySubmissionToken(token:string):Promise<string|null>;
  poll(externalTaskId:string,context:PollContext):Promise<ProviderPoll>;
  cancel(externalTaskId:string):Promise<boolean>;
  retrieve(poll:ProviderPoll,context:RetrieveContext):Promise<RetrievedVideo>;
  normalizeProgress(poll:ProviderPoll):{percent:number;stage:string;message:string};
  mapError(error:unknown):ProviderSafeError|SubmissionUnknownError;
}
