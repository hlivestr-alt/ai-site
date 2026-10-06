"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "./api";
import { ProductReferences } from "./product-references";

export type ProductDetail={
  pendingUploads:{assetId:string;versionId:string;slot:string}[];
  cover:{asset_id:string;version_id:string}|null;
  product:{id:string;status:"DRAFT"|"ACTIVE"|"ARCHIVED"};
  version:{id:string;version_number:number;brand:string;name:string;category:string;sku:string|null;description:string;key_selling_points:string[];target_audience:string};
  rules:{id:string;version_number:number;keep_logo:boolean;keep_packaging_text:boolean;keep_product_shape:boolean;keep_cap_pump:boolean;keep_product_color_material:boolean;keep_application_method:boolean;custom_instructions:string};
  assets:{id:string;slot:string;current_version_id:string|null;purpose:string;type:"IMAGE"|"VIDEO";status:string;original_filename:string|null;version_number:number|null;thumbnail_key:string|null}[];
  versionHistory:{id:string;version_number:number;created_at:string}[];
  ruleHistory:{id:string;version_number:number;created_at:string}[];
};
type Stage="basic"|"assets"|"rules";
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
  const [rules,setRules]=useState<Rules>(rulesFromDetail(initial));
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  const id=detail?.product.id;
  const base=id?`/api/workspaces/${workspaceId}/products/${id}`:"";

  function move(next:Stage){setStage(next);if(id)router.replace(`/products/${id}/edit?step=${next}`);}
  const reloadSequence=useRef(0);
  async function reload(){const sequence=++reloadSequence.current;if(id){const updated=await api<ProductDetail>(base);if(sequence===reloadSequence.current)setDetail(updated);}}
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
  async function saveRules(activate:boolean){if(!id)return;setBusy(true);setError("");setMessage("");try{
    if(JSON.stringify(rules)!==JSON.stringify(rulesFromDetail(detail)))await api(`${base}/rules`,"PATCH",rules);
    if(activate&&detail?.product.status==="DRAFT")await api(`${base}/activate`,"POST");
    router.replace(`/products/${id}`);router.refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not save rules or product.");}finally{setBusy(false);}}

  return <div className="wizard"><div className="page-heading"><div><p className="eyebrow">PRODUCT WORKSPACE</p><h1>{id?"Edit product":"Add product"}</h1><p>Build a reusable, versioned product reference.</p></div>{id&&<Link className="button secondary" href={`/products/${id}`}>Product detail</Link>}</div>
    <div className="wizard-steps">{(["basic","assets","rules"] as Stage[]).map((item,index)=><button key={item} className={stage===item?"step active":"step"} disabled={!id&&index>0} onClick={()=>move(item)}><span>{index+1}</span>{item==="basic"?"Basic info":item==="assets"?"Assets":"Accuracy & review"}</button>)}</div>
    {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice success">{message}</p>}
    {stage==="basic"&&<form className="panel wizard-panel" onSubmit={e=>void saveBasic(e)}><p className="eyebrow">01 / BASIC INFO</p><h2>Tell us about the product</h2><div className="form-grid"><label>Brand<input value={brand} onChange={e=>setBrand(e.target.value)} required maxLength={100} /></label><label>Product name<input value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={160} /></label><label>Category<input value={category} onChange={e=>setCategory(e.target.value)} required maxLength={100} /></label><label>SKU <small>(optional)</small><input value={sku} onChange={e=>setSku(e.target.value)} maxLength={80} /></label></div><label>Short description<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={3000} rows={4} /></label><div className="form-grid"><label>Key selling points <small>(one per line)</small><textarea value={points} onChange={e=>setPoints(e.target.value)} rows={5} placeholder="A customer benefit per line" /></label><label>Target audience<textarea value={audience} onChange={e=>setAudience(e.target.value)} maxLength={1000} rows={5} /></label></div><div className="wizard-actions"><button type="button" className="button secondary" disabled={busy} onClick={e=>void saveBasic(e as unknown as FormEvent,true)}>Save draft</button><button className="button primary" disabled={busy}>{busy?"Saving…":"Continue to assets"} <span>→</span></button></div></form>}
    {stage==="assets"&&id&&detail&&<><section className="panel wizard-panel"><p className="eyebrow">02 / REFERENCES</p><h2>Product references</h2><p className="muted">Images up to 20 MiB; MP4 video up to 500 MiB. Each file is validated before use.</p><ProductReferences workspaceId={workspaceId} detail={detail} onChange={reload}/></section><div className="wizard-actions"><button className="button secondary" onClick={()=>move("basic")}>Back</button><button className="button primary" onClick={()=>move("rules")}>Continue to accuracy &amp; review →</button></div></>}
    {stage==="rules"&&id&&<section className="panel wizard-panel"><p className="eyebrow">03 / ACCURACY & REVIEW</p><h2>Accuracy instructions</h2><p className="muted">These are instructions for later generation and review, not a guarantee of output fidelity.</p><div className="rule-grid">{ruleOptions.map(([key,label])=><label key={key} className="check-row"><input type="checkbox" checked={rules[key] as boolean} onChange={e=>setRules({...rules,[key]:e.target.checked})} /> {label}</label>)}</div><label>Additional instructions<textarea rows={4} maxLength={3000} value={rules.customInstructions} onChange={e=>setRules({...rules,customInstructions:e.target.value})} /></label><div className="review-card"><span className="eyebrow">REVIEW</span><strong>{name}</strong><p>{brand} · {category}{sku?` · SKU ${sku}`:""}</p><p>{detail?.assets.filter(a=>a.status==="READY").length||0} verified references · Product info v{detail?.version.version_number} · Rules v{detail?.rules.version_number}</p></div><div className="wizard-actions"><button className="button secondary" onClick={()=>move("assets")}>← Back</button><button className="button secondary" disabled={busy} onClick={()=>void saveRules(false)}>Save draft</button><button className="button primary" disabled={busy} onClick={()=>void saveRules(true)}>{busy?"Saving…":detail?.product.status==="DRAFT"?"Save product":"Save changes"} <span>→</span></button></div></section>}
  </div>;
}
