import {requestVerification} from '@/lib/auth';
import {body,handle,ok,requireSameOrigin} from '@/lib/http';
import {deliverLocalMail} from '@/lib/mail';
export async function POST(request:Request){return handle(async()=>{requireSameOrigin(request);const input=await body(request),verification=await requestVerification(input.email);if(verification)await deliverLocalMail(verification.email,'Verify your account',`${process.env.APP_BASE_URL}/verify?token=${verification.token}`);return ok({message:'If your account needs verification, a link has been queued.'});});}
