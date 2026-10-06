import Link from "next/link";
import { Shell } from "@/components/shell";
import { ProductActions, AssetVersionHistory } from "@/components/product-actions";
import { ProtectedMedia } from "@/components/protected-media";
import { pageWorkspace } from "@/lib/page";
import { getProductDetail } from "@/lib/products";
import { can, type Role } from "@/lib/permissions";
import { AppError } from "@/lib/core";
import { notFound } from "next/navigation";

export default async function ProductDetailPage({params}:{params:Promise<{productId:string}>}){
  const {session,workspaces,current}=await pageWorkspace();const {productId}=await params;
  const data=await getProductDetail(session,current.id,productId).catch(error=>{if(error instanceof AppError&&error.status===404)notFound();throw error;});
  const {product,version,rules,assets,versionHistory,ruleHistory}=data;
  const canEdit=can(current.role as Role,"future:edit");
  const activeRules=[
    [rules.keep_logo,"Keep logo"],[rules.keep_packaging_text,"Keep packaging text"],[rules.keep_product_shape,"Keep product shape"],
    [rules.keep_cap_pump,"Keep cap or pump"],[rules.keep_product_color_material,"Keep product color and material"],[rules.keep_application_method,"Keep application method"],
  ] as const;
  return <Shell user={session} workspaces={workspaces} current={current}><div className="breadcrumb"><Link href="/products">Products</Link> <span>›</span> {version.name}</div><div className="page-heading"><div><p className="eyebrow">{version.brand} · {version.category}</p><h1>{version.name}</h1><p>{version.sku?`SKU ${version.sku} · `:""}Information v{version.version_number} · Rules v{rules.version_number}</p></div><span className="pill">{product.status}</span></div>
    <ProductActions workspaceId={current.id} productId={productId} canEdit={canEdit} status={product.status} />
    <div className="detail-grid"><section className="panel"><p className="eyebrow">BASIC INFORMATION</p><h2>Product details</h2><p>{version.description||"No description added."}</p><h3>Key selling points</h3>{version.key_selling_points.length?<ul>{version.key_selling_points.map((point:string,i:number)=><li key={i}>{point}</li>)}</ul>:<p className="muted">No selling points added.</p>}<h3>Target audience</h3><p>{version.target_audience||"Not specified."}</p></section><section className="panel"><p className="eyebrow">ACCURACY INSTRUCTIONS</p><h2>Current rules · v{rules.version_number}</h2><ul className="rule-list">{activeRules.map(([enabled,label])=><li key={label}><span className={enabled?"rule-on":"rule-off"}>{enabled?"✓":"—"}</span>{label}</li>)}</ul>{rules.custom_instructions&&<p className="rule-note">{rules.custom_instructions}</p>}<small className="muted">Instructions for future generation and review; they do not guarantee fidelity.</small></section></div>
    <section className="panel"><div className="panel-head"><div><p className="eyebrow">PRIVATE REFERENCES</p><h2>Product assets</h2></div><span className="count">{assets.filter(a=>a.status==="READY").length} verified</span></div>{assets.some(a=>a.status==="READY")?<div className="asset-grid">{assets.filter(a=>a.status==="READY").map(asset=><div className="asset-card" key={asset.id}><div className="asset-visual"><ProtectedMedia workspaceId={current.id} productId={productId} assetId={asset.id} versionId={asset.current_version_id} type={asset.type} alt={`${asset.purpose} reference`} /></div><div className="asset-card-body"><span className="pill">{asset.purpose.replaceAll("_"," ")}</span><strong>{asset.original_filename}</strong><small>Version {asset.version_number} · {asset.type.toLowerCase()}</small><AssetVersionHistory workspaceId={current.id} productId={productId} assetId={asset.id} /></div></div>)}</div>:<p className="muted">No verified assets. Draft products need at least one reference before activation.</p>}</section>
    <div className="detail-grid"><section className="panel"><p className="eyebrow">HISTORY</p><h2>Information versions</h2>{versionHistory.map(item=><div className="list-row" key={item.id}><strong>Version {item.version_number}</strong><small>{new Date(item.created_at).toLocaleString("en-US",{timeZone:"UTC"})} UTC</small></div>)}</section><section className="panel"><p className="eyebrow">HISTORY</p><h2>Rule versions</h2>{ruleHistory.map(item=><div className="list-row" key={item.id}><strong>Version {item.version_number}</strong><small>{new Date(item.created_at).toLocaleString("en-US",{timeZone:"UTC"})} UTC</small></div>)}</section></div>
  </Shell>;
}
