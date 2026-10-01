import {type ClipperInput,type FrozenProduct} from "./job-core";
import {type SourceRow} from "./sources";
import {clipperRequest,ANALYZER_POLICY,RENDER_POLICY} from "./clipper-core";
export function prepareClipperInput(request:ReturnType<typeof clipperRequest>,source:SourceRow,product?:FrozenProduct){
    const {idempotencyKey,productId,sourceAssetId,...settings}=request;void productId;void idempotencyKey;
    const fake=process.env.APP_ENV==="local"&&process.env.ENABLE_FAKE_CLIP_ANALYZER==="1";
    const input:ClipperInput={schemaVersion:1,kind:"CLIPPER",analyzerProvider:fake?"fake":"openai",source:{origin:"SOURCE_ASSET",sourceAssetId,byteSize:Number(source.byte_size),mimeType:source.mime_type,storageKey:source.storage_key,storageIdentity:source.id,filename:source.original_filename,...(source.sha256?{sha256:source.sha256}:{})},...settings,...(product?{product}:{}),analyzerPolicyVersion:ANALYZER_POLICY,renderPolicyVersion:RENDER_POLICY};
    return input;
}
