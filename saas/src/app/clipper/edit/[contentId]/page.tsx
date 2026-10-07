import Link from 'next/link';
import {Shell} from '@/components/shell';
import {ClipperVariationEditor} from '@/components/clipper-variation-editor';
import {variationEditor} from '@/lib/clipper-variations';
import {pageWorkspace} from '@/lib/page';
import {can,type Role} from '@/lib/permissions';
import {AppError} from '@/lib/core';
import {notFound} from 'next/navigation';
export default async function EditClipPage({params}:{params:Promise<{contentId:string}>}){
 const {session,current,workspaces}=await pageWorkspace(),{contentId}=await params;
 const editor=await variationEditor(session,current.id,contentId).catch(e=>{if(e instanceof AppError&&[403,404].includes(e.status))notFound();if(e instanceof AppError&&e.status===409)return null;throw e;});
 return <Shell user={session} current={current} workspaces={workspaces}><div className="breadcrumb"><Link href="/clipper">Clipper</Link><span>›</span>Create variation</div><div className="page-heading"><div><p className="eyebrow">CLIPPER</p><h1>Edit / Create variation</h1></div></div>{!editor?<p className="notice">This clip’s saved editing inputs are unavailable. Its original output remains in Content Library.</p>:can(current.role as Role,'future:spend')?<ClipperVariationEditor workspaceId={current.id} initial={editor}/>:<p className="notice">Your workspace role allows previewing clips. Ask a workspace manager for permission to create a variation.</p>}</Shell>;
}
