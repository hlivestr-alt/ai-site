import {type ClipperInput,type FrozenProduct} from "./job-core";
import {type SourceRow} from "./sources";
import {clipperRequest,ANALYZER_POLICY,RENDER_POLICY} from "./clipper-core";
import {clipAnalyzerProvider,clipperConfigured} from './operational-config';
import {AppError} from './core';
export function prepareClipperInput(request:ReturnType<typeof clipperRequest>,source:SourceRow,product?:FrozenProduct){
    const {idempotencyKey,productId,sourceAssetId,...settings}=request;void productId;void idempotencyKey;
    const provider=clipAnalyzerProvider();
    if(!provider||!clipperConfigured())throw new AppError(503,"Clipping is unavailable until the analyzer is configured.");
    const input:ClipperInput={schemaVersion:1,kind:"CLIPPER",analyzerProvider:provider,...(provider==='wavespeed'?{analyzerModel:process.env.WAVESPEED_CLIP_MODEL!}:{}),source:{origin:"SOURCE_ASSET",sourceAssetId,byteSize:Number(source.byte_size),mimeType:source.mime_type,storageKey:source.storage_key,storageIdentity:source.id,filename:source.original_filename,...(source.sha256?{sha256:source.sha256}:{})},...settings,...(product?{product}:{}),analyzerPolicyVersion:ANALYZER_POLICY,renderPolicyVersion:RENDER_POLICY};
    return input;
}
