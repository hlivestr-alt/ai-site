"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "./api";
import { ProtectedMedia } from "./protected-media";

export type ProductDetail={
  product:{id:string;status:"DRAFT"|"ACTIVE"|"ARCHIVED"};
  version:{id:string;version_number:number;brand:string;name:string;category:string;sku:string|null;description:string;key_selling_points:string[];target_audience:string};
  rules:{id:string;version_number:number;keep_logo:boolean;keep_packaging_text:boolean;keep_product_shape:boolean;keep_cap_pump:boolean;keep_product_color_material:boolean;keep_application_method:boolean;custom_instructions:string};
  assets:{id:string;purpose:string;type:"IMAGE"|"VIDEO";status:string;original_filename:string|null;version_number:number|null;thumbnail_key:string|null}[];
  versionHistory:{id:string;version_number:number;created_at:string}[];
  ruleHistory:{id:string;version_number:number;created_at:string}[];
};
type Stage="basic"|"assets"|"rules";
const purposeOptions=["FRONT","BACK","LEFT_SIDE","RIGHT_SIDE","PACKAGING","CAP_PUMP","TEXTURE","USAGE_IMAGE","USAGE_VIDEO","PRODUCT_VIDEO","OTHER"];
const ruleOptions:[keyof Rules,string][]=[
  ["keepLogo","Keep logo"],["keepPackagingText","Keep packaging text"],["keepProductShape","Keep product shape"],
  ["keepCapPump","Keep cap or pump"],["keepProductColorMaterial","Keep product color and material"],["keepApplicationMethod","Keep application method"],
];
type Rules={keepLogo:boolean;keepPackagingText:boolean;keepProductShape:boolean;keepCapPump:boolean;keepProductColorMaterial:boolean;keepApplicationMethod:boolean;customInstructions:string};
function rulesFromDetail(detail?:ProductDetail):Rules {return {keepLogo:detail?.rules.keep_logo??true,keepPackagingText:detail?.rules.keep_packaging_text??true,keepProductShape:detail?.rules.keep_product_shape??true,keepCapPump:detail?.rules.keep_cap_pump??true,keepProductColorMaterial:detail?.rules.keep_product_color_material??true,keepApplicationMethod:detail?.rules.keep_application_method??true,customInstructions:detail?.rules.custom_instructions??""};}

export function ProductWizard({workspaceId,initial,initialStage="basic"}:{workspaceId:string;initial?:ProductDetail;initialStage?:Stage}) {
  const router=useRouter();
  const [detail,setDetail]=useState(initial);
  const [stage,setStage]=useState<Stage>(initialStage);
  const [brand,setBrand]=useState(initial?.version.brand||"");const [name,setName]=useState(initial?.version.name||"");const [category,setCategory]=useState(initial?.version.category||"");
  const [sku,setSku]=useState(initial?.version.sku||"");const [description,setDescription]=useState(initial?.version.description||"");
  const [points,setPoints]=useState(initial?.version.key_selling_points.join("\n")||"");const [audience,setAudience]=useState(initial?.version.target_audience||"");
  const [purpose,setPurpose]=useState("FRONT");const [sourceType,setSourceType]=useState("CUSTOMER_UPLOAD");const [permissionNote,setPermissionNote]=useState("");const [permissionConfirmed,setPermissionConfirmed]=useState(false);
  const [file,setFile]=useState<File|null>(null);const [replaceAsset,setReplaceAsset]=useState("");
  const [rules,setRules]=useState<Rules>(rulesFromDetail(initial));
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  const id=detail?.product.id;
  const base=id?`/api/workspaces/${workspaceId}/products/${id}`:"";

  function move(next:Stage){setStage(next);if(id)router.replace(`/products/${id}/edit?step=${next}`);}
  async function reload(){if(id)setDetail(await api<ProductDetail>(base));}
  async function saveBasic(event:FormEvent,asDraft=false){
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try {
      const input={brand,name,category,sku,description,keySellingPoints:points.split("\n").map(x=>x.trim()).filter(Boolean),targetAudience:audience};
      if(!id){const result=await api<{product:{id:string}}>(`/api/workspaces/${workspaceId}/products`,"POST",input);router.replace(asDraft?`/products/${result.product.id}`:`/products/${result.product.id}/edit?step=assets`);router.refresh();return;}
      const original={brand:detail.version.brand,name:detail.version.name,category:detail.version.category,sku:detail.version.sku||"",description:detail.version.description,keySellingPoints:detail.version.key_selling_points,targetAudience:detail.version.target_audience};
      if(JSON.stringify(input)!==JSON.stringify(original))await api(base,"PATCH",input);
      await reload();if(asDraft){router.replace(`/products/${id}`);router.refresh();}else move("assets");
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not save product.");}finally{setBusy(false);}
  }
  async function upload(event:FormEvent){
    event.preventDefault();if(!file||!id)return;setBusy(true);setError("");setMessage("");
    try{
      const selected=detail?.assets.find(a=>a.id===replaceAsset);
      const selectedPurpose=selected?.purpose||purpose;
      let sha256:string|undefined;
      if(file.type.startsWith("image/")){const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");}
      const path=replaceAsset?`${base}/assets/${replaceAsset}/upload-intents`:`${base}/assets/upload-intents`;
      const created=await api<{intent:{assetId:string;versionId:string;uploadUrl:string;requiredHeaders:Record<string,string>}}>(path,"POST",{purpose:selectedPurpose,mimeType:file.type,byteSize:file.size,filename:file.name,sha256,sourceType,permissionNote,permissionConfirmed});
      const intent=created.intent;
      const sent=await fetch(intent.uploadUrl,{method:"PUT",headers:intent.requiredHeaders,body:file});
      if(!sent.ok)throw new Error(`Storage upload failed (${sent.status}). Retry with a new upload intent.`);
      await api(`${base}/assets/${intent.assetId}/versions/${intent.versionId}/finalize`,"POST");
      await reload();setFile(null);setReplaceAsset("");setPermissionConfirmed(false);setPermissionNote("");
      const input=document.querySelector<HTMLInputElement>("#asset-file");if(input)input.value="";
      setMessage("Reference uploaded and verified.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Upload failed. The draft is still saved.");}finally{setBusy(false);}
  }
  async function archiveAsset(assetId:string){if(!id)return;setBusy(true);setError("");try{await api(`${base}/assets/${assetId}`,"DELETE");await reload();}catch(cause){setError(cause instanceof Error?cause.message:"Could not archive asset.");}finally{setBusy(false);}}
  async function saveRules(activate:boolean){if(!id)return;setBusy(true);setError("");setMessage("");try{
    if(JSON.stringify(rules)!==JSON.stringify(rulesFromDetail(detail)))await api(`${base}/rules`,"PATCH",rules);
    if(activate&&detail?.product.status==="DRAFT")await api(`${base}/activate`,"POST");
    router.replace(`/products/${id}`);router.refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not save rules or product.");}finally{setBusy(false);}}

  return <div className="wizard"><div className="page-heading"><div><p className="eyebrow">PRODUCT WORKSPACE</p><h1>{id?"Edit product":"Add product"}</h1><p>Build a reusable, versioned product reference.</p></div>{id&&<Link className="button secondary" href={`/products/${id}`}>Product detail</Link>}</div>
    <div className="wizard-steps">{(["basic","assets","rules"] as Stage[]).map((item,index)=><button key={item} className={stage===item?"step active":"step"} disabled={!id&&index>0} onClick={()=>move(item)}><span>{index+1}</span>{item==="basic"?"Basic info":item==="assets"?"Assets":"Accuracy & review"}</button>)}</div>
    {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice success">{message}</p>}
    {stage==="basic"&&<form className="panel wizard-panel" onSubmit={e=>void saveBasic(e)}><p className="eyebrow">01 / BASIC INFO</p><h2>Tell us about the product</h2><div className="form-grid"><label>Brand<input value={brand} onChange={e=>setBrand(e.target.value)} required maxLength={100} /></label><label>Product name<input value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={160} /></label><label>Category<input value={category} onChange={e=>setCategory(e.target.value)} required maxLength={100} /></label><label>SKU <small>(optional)</small><input value={sku} onChange={e=>setSku(e.target.value)} maxLength={80} /></label></div><label>Short description<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={3000} rows={4} /></label><div className="form-grid"><label>Key selling points <small>(one per line)</small><textarea value={points} onChange={e=>setPoints(e.target.value)} rows={5} placeholder="A customer benefit per line" /></label><label>Target audience<textarea value={audience} onChange={e=>setAudience(e.target.value)} maxLength={1000} rows={5} /></label></div><div className="wizard-actions"><button type="button" className="button secondary" disabled={busy} onClick={e=>void saveBasic(e as unknown as FormEvent,true)}>Save draft</button><button className="button primary" disabled={busy}>{busy?"Saving…":"Continue to assets"} <span>→</span></button></div></form>}
    {stage==="assets"&&id&&<><section className="panel wizard-panel"><p className="eyebrow">02 / REFERENCES</p><h2>Product assets</h2><p className="muted">Upload private product references. Images up to 20 MiB; MP4 video up to 500 MiB. Each file is verified before use.</p><div className="asset-grid">{detail?.assets.filter(a=>a.status==="READY").map(asset=><div className="asset-card" key={asset.id}><div className="asset-visual"><ProtectedMedia workspaceId={workspaceId} productId={id} assetId={asset.id} type={asset.type} alt={asset.purpose.replaceAll("_"," ")} /></div><div className="asset-card-body"><span className="pill">{asset.purpose.replaceAll("_"," ")}</span><strong>{asset.original_filename}</strong><small>Version {asset.version_number} · private</small><button type="button" className="text-button danger" disabled={busy} onClick={()=>void archiveAsset(asset.id)}>Archive</button></div></div>)}{!detail?.assets.some(a=>a.status==="READY")&&<p className="muted">No verified references yet.</p>}</div></section><form className="panel wizard-panel" onSubmit={e=>void upload(e)}><p className="eyebrow">ADD A REFERENCE</p><h2>Upload file</h2><div className="form-grid"><label>Replace existing asset <small>(optional)</small><select value={replaceAsset} onChange={e=>{setReplaceAsset(e.target.value);const a=detail?.assets.find(a=>a.id===e.target.value);if(a)setPurpose(a.purpose);}}><option value="">Add a new asset</option>{detail?.assets.filter(a=>a.status==="READY").map(a=><option key={a.id} value={a.id}>{a.purpose} · {a.original_filename}</option>)}</select></label><label>Reference purpose<select value={purpose} disabled={!!replaceAsset} onChange={e=>setPurpose(e.target.value)}>{purposeOptions.map(p=><option key={p} value={p}>{p.replaceAll("_"," ")}</option>)}</select></label><label>Source<select value={sourceType} onChange={e=>setSourceType(e.target.value)}>{["CUSTOMER_UPLOAD","CUSTOMER_OWNED","LICENSED","CREATOR_AUTHORIZED","OTHER"].map(x=><option key={x}>{x}</option>)}</select></label><label>File<input id="asset-file" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" required onChange={e=>setFile(e.target.files?.[0]||null)} /></label></div><label>Permission note <small>(optional)</small><textarea rows={2} maxLength={1000} value={permissionNote} onChange={e=>setPermissionNote(e.target.value)} /></label><label className="check-row"><input type="checkbox" checked={permissionConfirmed} onChange={e=>setPermissionConfirmed(e.target.checked)} required /> I confirm I have permission to use this media.</label><button className="button primary" disabled={busy||!file}>{busy?"Uploading & verifying…":"Upload reference"}</button></form><div className="wizard-actions"><button className="button secondary" onClick={()=>move("basic")}>← Back</button><button className="button primary" onClick={()=>move("rules")}>Continue to rules <span>→</span></button></div></>}
    {stage==="rules"&&id&&<section className="panel wizard-panel"><p className="eyebrow">03 / ACCURACY & REVIEW</p><h2>Accuracy instructions</h2><p className="muted">These are instructions for later generation and review, not a guarantee of output fidelity.</p><div className="rule-grid">{ruleOptions.map(([key,label])=><label key={key} className="check-row"><input type="checkbox" checked={rules[key] as boolean} onChange={e=>setRules({...rules,[key]:e.target.checked})} /> {label}</label>)}</div><label>Additional instructions<textarea rows={4} maxLength={3000} value={rules.customInstructions} onChange={e=>setRules({...rules,customInstructions:e.target.value})} /></label><div className="review-card"><span className="eyebrow">REVIEW</span><strong>{name}</strong><p>{brand} · {category}{sku?` · SKU ${sku}`:""}</p><p>{detail?.assets.filter(a=>a.status==="READY").length||0} verified references · Product info v{detail?.version.version_number} · Rules v{detail?.rules.version_number}</p></div><div className="wizard-actions"><button className="button secondary" onClick={()=>move("assets")}>← Back</button><button className="button secondary" disabled={busy} onClick={()=>void saveRules(false)}>Save draft</button><button className="button primary" disabled={busy} onClick={()=>void saveRules(true)}>{busy?"Saving…":detail?.product.status==="DRAFT"?"Save product":"Save changes"} <span>→</span></button></div></section>}
  </div>;
}
