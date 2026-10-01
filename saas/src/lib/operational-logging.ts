import {AsyncLocalStorage} from "node:async_hooks";
export const requestContext=new AsyncLocalStorage<{requestId:string}>();
export function correlationMetadata(){const id=requestContext.getStore()?.requestId;return id?{requestId:id}:{};}
export function operationalLog(service:string,event:string,data:Record<string,string|number|boolean|null>={}){
  // Call sites supply an explicit safe projection, never an Error/message or request payload.
  console.error(JSON.stringify({time:new Date().toISOString(),service,event,...correlationMetadata(),...data}));
}
