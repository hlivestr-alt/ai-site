"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {api} from "./api";
export type TokenQuote={id:string;quoteHash:string;tokenAmount:string;availableTokens:string;reservedTokens:string;affordable:boolean;expiresAt:string;test:boolean;priceLabel:string};
export function useTokenQuote(workspaceId:string,operation:"AI_VIDEO"|"CLIPPER",input:Record<string,unknown>,enabled:boolean){const serialized=JSON.stringify(input);const [stored,setStored]=useState<{quote:TokenQuote;request:string}|null>(null),[error,setError]=useState(""),[refresh,setRefresh]=useState(0);
 useEffect(()=>{if(!enabled)return;let active=true;const timer=setTimeout(()=>{void api<{quote:TokenQuote}>(`/api/workspaces/${workspaceId}/billing/quotes`,"POST",{...JSON.parse(serialized),operation}).then(r=>{if(active){setStored({quote:r.quote,request:serialized});setError("");}}).catch(e=>{if(active){setStored(null);setError(e.message);}});},350);return()=>{active=false;clearTimeout(timer);};},[workspaceId,operation,serialized,enabled,refresh]);
 const quote=enabled&&stored?.request===serialized?stored.quote:null;
 useEffect(()=>{if(!quote)return;const timer=setTimeout(()=>{setStored(null);setRefresh(x=>x+1);},Math.max(1,Date.parse(quote.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[quote]);
 return {quote,error:enabled?error:"",loading:enabled&&!quote&&!error};
}
export function TokenQuoteView({quote,error,loading}:{quote:TokenQuote|null;error:string;loading:boolean}){return <div className="review-card" aria-live="polite"><strong>{quote?`${BigInt(quote.tokenAmount).toLocaleString("en-US")} tokens`:loading?"Calculating token quote…":"Configure your request for a token quote"}</strong>{quote&&<><p>Available {BigInt(quote.availableTokens).toLocaleString("en-US")} · Reserved {BigInt(quote.reservedTokens).toLocaleString("en-US")}</p><p>Tokens are reserved when you submit, captured on success, and released after a definite failure or cancellation.</p>{quote.test&&<p>TEST token price · {quote.priceLabel}</p>}{!quote.affordable&&<p role="alert">Insufficient tokens. <Link href="/billing">Buy Tokens →</Link></p>}</>}{error&&<p role="alert">{error}</p>}</div>;}
