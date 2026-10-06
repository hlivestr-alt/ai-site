import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import nodemailer from 'nodemailer';
import {query,transaction,type DbClient} from './db';
import {nonProductionTestAllowed} from './operational-config';
import {operationalLog} from './operational-logging';
function encryptionKey(){if(process.env.MAIL_ENCRYPTION_KEY&&/^[a-f0-9]{64}$/i.test(process.env.MAIL_ENCRYPTION_KEY))return Buffer.from(process.env.MAIL_ENCRYPTION_KEY,'hex');if(nonProductionTestAllowed())return createHash('sha256').update('local-only-development-mail-key').digest();throw new Error('Mail encryption key is not configured');}
export function encryptMail(url:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv),payload=Buffer.concat([cipher.update(url,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),payload].map(b=>b.toString('base64url')).join('.');}
export function decryptMail(payload:string){const [iv,tag,data]=payload.split('.').map(v=>Buffer.from(v,'base64url')),decipher=createDecipheriv('aes-256-gcm',encryptionKey(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');}
export type MailMessage={id:string;to:string;subject:string;url:string};
export interface MailProvider{send(message:MailMessage):Promise<void>}
export function mailProvider():MailProvider{
  const provider=process.env.MAIL_PROVIDER||(process.env.MAIL_MODE==='development_file'?'development_file':'');
  if(provider==='development_file'||provider==='fake'){
    if(!nonProductionTestAllowed())throw new Error('Development mail is unavailable');
    return {async send(message){if(process.env.ENABLE_TEST_MAIL_FAILURE==='1')throw new Error('MAIL_TEST_FAILURE');await mkdir(join(process.cwd(),'data','mailbox'),{recursive:true});await writeFile(join(process.cwd(),'data','mailbox',`${Date.now()}-${message.id}.json`),JSON.stringify({to:message.to,subject:message.subject,url:message.url,createdAt:new Date().toISOString()}),{encoding:'utf8',flag:'wx',mode:0o600});}};
  }
  if(provider!=='smtp')throw new Error('Mail transport unavailable');
  const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT)===465,requireTLS:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},tls:{rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
  return {async send(message){await transport.sendMail({from:process.env.MAIL_FROM,to:message.to,subject:message.subject,text:`${message.subject}\n\n${message.url}\n\nIf you did not request this, you can ignore it.`,messageId:`<${message.id}@${new URL(process.env.APP_BASE_URL!).hostname}>`});}};
}
export async function enqueueMail(db:DbClient,to:string,subject:string,url:string,authTokenId?:string){return (await db.query<{id:string}>('INSERT INTO mail_deliveries(recipient,subject,encrypted_payload,auth_token_id) VALUES($1,$2,$3,$4) RETURNING id',[to,subject,encryptMail(url),authTokenId||null])).rows[0].id;}
export async function deliverMail(to:string,subject:string,url:string){const id=await transaction(db=>enqueueMail(db,to,subject,url));await mailDeliveryBatch(1,id);return {queued:true};}
export async function mailDeliveryBatch(limit=5,id?:string){let delivered=0;await query("UPDATE mail_deliveries SET status='FAILED',last_error_code='MAIL_UNAVAILABLE' WHERE status='SENDING' AND attempts>=5 AND available_at<=now()");for(let n=0;n<Math.min(limit,25);n++){
  await query("UPDATE mail_deliveries m SET status='FAILED',last_error_code='MAIL_SUPERSEDED' FROM auth_tokens t WHERE m.auth_token_id=t.id AND m.status IN('PENDING','SENDING') AND (t.used_at IS NOT NULL OR t.expires_at<=now())");
  const task=await transaction(async db=>{const row=(await db.query<{id:string;recipient:string;subject:string;encrypted_payload:string;attempts:number}>("SELECT m.* FROM mail_deliveries m WHERE m.status IN('PENDING','SENDING') AND m.available_at<=now() AND m.attempts<5 AND ($1::uuid IS NULL OR m.id=$1) AND (m.auth_token_id IS NULL OR EXISTS(SELECT 1 FROM auth_tokens t WHERE t.id=m.auth_token_id AND t.used_at IS NULL AND t.expires_at>now())) ORDER BY m.available_at,m.id LIMIT 1 FOR UPDATE OF m SKIP LOCKED",[id||null])).rows[0];if(!row)return null;await db.query("UPDATE mail_deliveries SET status='SENDING',attempts=attempts+1,available_at=now()+interval '1 minute' WHERE id=$1",[row.id]);return {...row,attempts:row.attempts+1};});
  if(!task)break;
  try{await mailProvider().send({id:task.id,to:task.recipient,subject:task.subject,url:decryptMail(task.encrypted_payload)});await query("UPDATE mail_deliveries SET status='SENT',sent_at=now(),last_error_code=NULL WHERE id=$1 AND attempts=$2",[task.id,task.attempts]);delivered++;}
  catch{await query("UPDATE mail_deliveries SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,last_error_code='MAIL_UNAVAILABLE',available_at=now()+interval '1 minute' WHERE id=$1 AND attempts=$2",[task.id,task.attempts]);operationalLog('mail','delivery_failed',{mailId:task.id,code:'MAIL_UNAVAILABLE',attempt:task.attempts});}
 }return delivered;}
