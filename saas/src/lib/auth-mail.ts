import "server-only";
import { after } from "next/server";
import { mailDeliveryBatch } from "./mail-core";
import { operationalLog } from "./operational-logging";

export function dispatchAuthMail(deliveryId:string|null) {
  if(deliveryId)after(async()=>{
    try { await mailDeliveryBatch(1,deliveryId); }
    catch { operationalLog('mail','delivery_failed',{mailId:deliveryId,code:'MAIL_UNAVAILABLE'}); }
  });
}
