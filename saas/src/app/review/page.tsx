import {Shell} from "@/components/shell";
import {ContentLibrary} from "@/components/content-library";
import {contentList,contentProductOptions} from "@/lib/content";
import {pageWorkspace} from "@/lib/page";
export default async function ReviewPage({searchParams}:{searchParams:Promise<{type?:string;productId?:string;search?:string;page?:string}>}){
  const {session,workspaces,current}=await pageWorkspace(),filters=await searchParams;
  const [list,products]=await Promise.all([contentList(session,current.id,{...filters,status:"PENDING_REVIEW",page:filters.page?Number(filters.page):1}),contentProductOptions(session,current.id)]);
  return <Shell user={session} workspaces={workspaces} current={current}><div className="page-heading"><div><p className="eyebrow">HUMAN REVIEW</p><h1>Review Center</h1><p>Compare each output with the saved context before making a decision.</p></div></div><ContentLibrary workspaceId={current.id} list={list} products={products} filters={filters} review/></Shell>;
}
