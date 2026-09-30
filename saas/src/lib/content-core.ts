import {createHash} from "node:crypto";
import {AppError,isUuid} from "./core";
import {GENERIC_REJECTION_CATEGORIES,PRODUCT_REJECTION_CATEGORIES} from "./content-rules";
export function reviewRequest(raw:Record<string,unknown>,productBacked:boolean){
  if(typeof raw.versionId!=="string"||!isUuid(raw.versionId)||!["APPROVE","REJECT"].includes(String(raw.decision))||typeof raw.requestKey!=="string"||!/^[A-Za-z0-9:_-]{8,160}$/.test(raw.requestKey)||typeof raw.expectedRevision!=="number"||!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0)throw new AppError(400,"Invalid review request.");
  const decision=raw.decision as "APPROVE"|"REJECT";
  let reasonCategory:string|null=null,reasonText:string|null=null;
  if(decision==="REJECT"){
    const categories=productBacked?PRODUCT_REJECTION_CATEGORIES:GENERIC_REJECTION_CATEGORIES;
    if(typeof raw.reasonCategory!=="string"||!(categories as readonly string[]).includes(raw.reasonCategory))throw new AppError(400,"Choose a valid rejection category.");
    if(raw.reasonText!==undefined&&(typeof raw.reasonText!=="string"||raw.reasonText.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw.reasonText)))throw new AppError(400,"Reason must be at most 1000 readable characters.");
    reasonCategory=raw.reasonCategory;reasonText=typeof raw.reasonText==="string"?raw.reasonText.trim()||null:null;
  }else if(raw.reasonCategory||raw.reasonText)throw new AppError(400,"Approval does not take a rejection reason.");
  const request={versionId:raw.versionId,decision,reasonCategory,reasonText,expectedRevision:raw.expectedRevision};
  return {...request,requestKey:raw.requestKey,requestHash:createHash("sha256").update(JSON.stringify(request)).digest("hex")};
}
export function contentFilename(title:string,type:string){const stem=title.normalize("NFKD").replace(/[^A-Za-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,70)||"content";return `${stem}-${type==="CLIP"?"clip":"ai-video"}.mp4`;}
export type ContentListOptions={type?:string;status?:string;productId?:string;search?:string;page?:number};
export function contentFilters(options:ContentListOptions){
  const type=options.type||"ALL",status=options.status||"ACTIVE",productId=options.productId||"",search=(options.search||"").trim();
  if(!["ALL","AI_VIDEO","CLIP"].includes(type)||!["ACTIVE","ALL","PENDING_REVIEW","APPROVED","REJECTED","ARCHIVED"].includes(status)||productId&&!isUuid(productId)||search.length>100)throw new AppError(400,"Invalid Content filter.");
  const page=options.page??1;if(!Number.isInteger(page)||page<1||page>500)throw new AppError(400,"Invalid page.");
  return {type,status,productId,search,page,pageSize:24,pattern:`%${search.replace(/[\\%_]/g,"\\$&")}%`};
}
