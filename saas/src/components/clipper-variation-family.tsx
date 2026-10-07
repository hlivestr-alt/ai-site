import Link from 'next/link';
export function ClipperVariationFamily({family}:{family:{rootContentId:string;variations:{id:string;number:number;name:string;jobId:string;status:string;contentId:string|null;parentNumber:number|null}[]}}){
 if(!family.variations.length)return null;
 return <section className="panel"><h2>Original and variations</h2><p><Link href={`/content/${family.rootContentId}`}>Original clip</Link></p><ul className="variation-family">{family.variations.map(v=><li key={v.id}><Link href={v.contentId?`/content/${v.contentId}`:`/clipper/${v.jobId}`}>Variation {v.number}{v.name?` · ${v.name}`:''}</Link><span className="pill">{v.status.replaceAll('_',' ')}</span><small>{v.parentNumber?`From Variation ${v.parentNumber}`:'From Original'}</small></li>)}</ul></section>;
}
