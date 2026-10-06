import {requestVerification} from '@/lib/auth';
import {body,handle,ok,requireSameOrigin} from '@/lib/http';
import {dispatchAuthMail} from '@/lib/auth-mail';
export async function POST(request:Request){return handle(async()=>{requireSameOrigin(request);const input=await body(request);dispatchAuthMail(await requestVerification(input.email));return ok({message:'Check your email. If your account needs verification, a link has been queued.'});});}
