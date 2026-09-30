import {Shell} from "@/components/shell";
import {ContentLibrary} from "@/components/content-library";
import {contentList,contentProductOptions} from "@/lib/content";
import {pageWorkspace} from "@/lib/page";
export default async function ContentPage({searchParams}:{searchParams:Promise<{type?:string;status?:string;productId?:string;search?:string;page?:string}>}){
  const {session,workspaces,current}=await pageWorkspace(),filters=await searchParams;
  const [list,products]=await Promise.all([contentList(session,current.id,{...filters,page:filters.page?Number(filters.page):1}),contentProductOptions(session,current.id)]);
  return <Shell user={session} workspaces={workspaces} current={current}><div className="page-heading"><div><p className="eyebrow">YOUR MEDIA</p><h1>Content Library</h1><p>Private outputs with saved context and review history.</p></div></div><ContentLibrary workspaceId={current.id} list={list} products={products} filters={filters}/></Shell>;
}
