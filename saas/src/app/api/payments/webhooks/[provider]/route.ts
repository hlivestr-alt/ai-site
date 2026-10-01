import {transaction} from "@/lib/db";
import {issue} from "@/lib/billing-core";
import {handle,ok} from "@/lib/http";
import {AppError} from "@/lib/core";
import {paymentProvider} from "@/lib/payment-providers";
import {processPaymentEvent} from "@/lib/payments-core";
export async function POST(request:Request,{params}:{params:Promise<{provider:string}>}){return handle(async()=>{const {provider}=await params;if(!["fake","xendit"].includes(provider))throw new AppError(404,"Not found.");const adapter=paymentProvider(provider);if(Number(request.headers.get("content-length")||0)>65536)throw new AppError(413,"Webhook too large.");const reader=request.body?.getReader();if(!reader)throw new AppError(400,"Empty webhook.");const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new AppError(413,"Webhook too large.");}chunks.push(value);}const raw=Buffer.concat(chunks);try{adapter.verifyWebhook(raw,request.headers);}catch(e){await transaction(db=>issue(db,"WEBHOOK_AUTH_FAILED",null,null,null,provider));throw e;}let event;try{event=adapter.parseWebhook(raw);}catch(e){if(e instanceof AppError)throw e;throw new AppError(400,"Invalid webhook.");}return ok(await processPaymentEvent(adapter.name,event));});}
