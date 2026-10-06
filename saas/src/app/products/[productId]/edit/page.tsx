import { redirect, notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { ProductWizard, type ProductDetail } from "@/components/product-wizard";
import { pageWorkspace } from "@/lib/page";
import { getProductDetail } from "@/lib/products";
import { can, type Role } from "@/lib/permissions";
import { AppError } from "@/lib/core";
export default async function EditProduct({params,searchParams}:{params:Promise<{productId:string}>;searchParams:Promise<{step?:string}>}){
  const {session,workspaces,current}=await pageWorkspace();if(!can(current.role as Role,"future:edit"))redirect("/products");
  const {productId}=await params;const detail=await getProductDetail(session,current.id,productId).catch(error=>{if(error instanceof AppError&&error.status===404)notFound();throw error;});if(detail.product.status==="ARCHIVED")redirect(`/products/${productId}`);
  const {product,cover,pendingUploads,version,rules,versionHistory,ruleHistory,assets}=detail;
  const initial=JSON.parse(JSON.stringify({product,cover,pendingUploads,version,rules,versionHistory,ruleHistory,assets})) as ProductDetail;
  const step=(await searchParams).step;const initialStage=step==="assets"||step==="rules"?step:"basic";
  return <Shell user={session} workspaces={workspaces} current={current}><ProductWizard workspaceId={current.id} initial={initial} initialStage={initialStage} /></Shell>;
}
