import { ProtectedMedia } from "@/components/protected-media";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { pageWorkspace } from "@/lib/page";
import { listProducts } from "@/lib/products";
import { can, type Role } from "@/lib/permissions";

export default async function Products({searchParams}:{searchParams:Promise<{search?:string;status?:string;page?:string}>}) {
  const {session,workspaces,current}=await pageWorkspace();
  const params=await searchParams;
  const data=await listProducts(session,current.id,{search:params.search,status:params.status,page:Number(params.page||1)});
  const canEdit=can(current.role as Role,"future:edit");
  const next=(page:number)=>`/products?${new URLSearchParams({search:params.search||"",status:params.status||"CURRENT",page:String(page)})}`;
  return <Shell user={session} workspaces={workspaces} current={current}><div className="page-heading"><div><p className="eyebrow">CATALOG</p><h1>Products</h1><p>Versioned references for this workspace.</p></div>{canEdit&&<Link className="button primary" href="/products/new">Add product <span>→</span></Link>}</div>
    <form className="product-filters" action="/products" method="GET"><label>Search<input name="search" defaultValue={params.search||""} placeholder="Name, brand or SKU" /></label><label>Status<select name="status" defaultValue={params.status||"CURRENT"}><option value="CURRENT">Current</option><option value="ACTIVE">Active</option><option value="DRAFT">Drafts</option><option value="ARCHIVED">Archived</option></select></label><button className="button secondary">Search</button></form>
    <div className="list-meta">{data.total} {data.total===1?"product":"products"} in this view</div>
    {data.products.length?<div className="product-grid">{data.products.map(product=><Link href={`/products/${product.id}`} className="product-card" key={product.id}><div className="product-card-art">{product.cover?<ProtectedMedia workspaceId={current.id} productId={product.id} assetId={product.cover.asset_id} versionId={product.cover.version_id} type="IMAGE" alt={`${product.name} cover`} initial={product.name.slice(0,1).toUpperCase()}/>:<span>{product.name.slice(0,1).toUpperCase()}</span>}</div><div className="product-card-body"><div className="product-card-top"><span className="eyebrow">{product.brand}</span><span className="pill">{product.status}</span></div><h2>{product.name}</h2><p>{product.category}{product.sku?` · ${product.sku}`:""}</p><small>Info v{product.version_number} · {product.asset_count} verified {Number(product.asset_count)===1?"asset":"assets"}</small></div></Link>)}</div>:<section className="panel empty-panel"><div className="empty-icon">◇</div><p className="eyebrow">NO PRODUCTS</p><h2>{params.search?"No matching products":"Your product catalog starts here"}</h2><p>{params.search?"Try another search or status filter.":"Add your first product, then upload private references and set accuracy instructions."}</p>{canEdit&&<Link className="button primary" href="/products/new">Add product <span>→</span></Link>}</section>}
    {data.total>data.pageSize&&<nav className="pager" aria-label="Product pages">{data.page>1&&<Link className="button secondary" href={next(data.page-1)}>← Previous</Link>}<span>Page {data.page} of {Math.ceil(data.total/data.pageSize)}</span>{data.page*data.pageSize<data.total&&<Link className="button secondary" href={next(data.page+1)}>Next →</Link>}</nav>}
  </Shell>;
}
