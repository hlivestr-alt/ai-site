import http from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const targetHost=process.env.TARGET_HOST||"object-storage";
const targetPort=Number(process.env.TARGET_PORT||4566);
const allowedOrigin="http://127.0.0.1:3200";
const accessKey=process.env.OBJECT_STORAGE_ACCESS_KEY;
const secretKey=process.env.OBJECT_STORAGE_SECRET_KEY;
if(!accessKey||!secretKey)throw new Error("Gateway signing credentials are required");

const sha=value=>createHash("sha256").update(value).digest("hex");
const hmac=(key,value)=>createHmac("sha256",key).update(value).digest();
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const normal=value=>String(value).trim().replace(/\s+/g," ");
function forbidden(response){response.writeHead(403,{"Content-Type":"application/json"});response.end(JSON.stringify({error:"Valid signed S3 request required"}));}
function verify(request,parsed){
  const query=parsed.searchParams;
  const isQuery=query.has("X-Amz-Signature");
  const auth=request.headers.authorization||"";
  if(!isQuery&&!auth.startsWith("AWS4-HMAC-SHA256 "))return false;
  const fields=isQuery?Object.fromEntries(["Algorithm","Credential","Date","Expires","SignedHeaders","Signature"].map(x=>[x,query.get(`X-Amz-${x}`)]))
    :Object.fromEntries([...auth.replace(/^AWS4-HMAC-SHA256\s+/,"").matchAll(/(Credential|SignedHeaders|Signature)=([^,\s]+)/g)].map(x=>[x[1],x[2]]));
  if(isQuery&&fields.Algorithm!=="AWS4-HMAC-SHA256")return false;
  const date=isQuery?fields.Date:request.headers["x-amz-date"];
  const stamp=typeof date==="string"&&/^\d{8}T\d{6}Z$/.test(date)?Date.UTC(Number(date.slice(0,4)),Number(date.slice(4,6))-1,Number(date.slice(6,8)),Number(date.slice(9,11)),Number(date.slice(11,13)),Number(date.slice(13,15))):NaN;
  if(!Number.isFinite(stamp)||Date.now()<stamp-15*60_000)return false;
  const expires=Number(fields.Expires);
  if(isQuery?(!Number.isInteger(expires)||expires<1||expires>604800||Date.now()>stamp+expires*1000):Date.now()>stamp+15*60_000)return false;
  const credential=fields.Credential?.split("/");
  if(credential?.length!==5||credential[0]!==accessKey||credential[1]!==date.slice(0,8)||credential[3]!=="s3"||credential[4]!=="aws4_request")return false;
  const signedHeaders=fields.SignedHeaders;
  if(!signedHeaders||!/^[-a-z0-9;]+$/.test(signedHeaders)||!signedHeaders.split(";").includes("host"))return false;
  const headers=signedHeaders.split(";");
  if(headers.join(";")!==[...headers].sort().join(";"))return false;
  let canonicalHeaders="";
  for(const name of headers){const value=request.headers[name];if(typeof value!=="string")return false;canonicalHeaders+=`${name}:${normal(value)}\n`;}
  const canonicalUri=parsed.pathname.split("/").map(x=>encode(decodeURIComponent(x))).join("/");
  const canonicalQuery=[...query.entries()].filter(([key])=>!(isQuery&&key==="X-Amz-Signature"))
    .map(([key,value])=>[encode(key),encode(value)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0).map(([key,value])=>`${key}=${value}`).join("&");
  const payload=isQuery?"UNSIGNED-PAYLOAD":request.headers["x-amz-content-sha256"]||sha("");
  if(typeof payload!=="string")return false;
  const canonical=[request.method,canonicalUri,canonicalQuery,canonicalHeaders,signedHeaders,payload].join("\n");
  const scope=credential.slice(1).join("/");
  const toSign=["AWS4-HMAC-SHA256",date,scope,sha(canonical)].join("\n");
  const key=hmac(hmac(hmac(hmac(`AWS4${secretKey}`,credential[1]),credential[2]),"s3"),"aws4_request");
  const expected=hmac(key,toSign).toString("hex");
  const actual=fields.Signature||"";
  return /^[a-f0-9]{64}$/.test(actual)&&timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(actual,"hex"));
}

http.createServer((request,response)=>{
  if(request.url==="/health"){response.writeHead(200,{"Content-Type":"text/plain"});response.end("ready");return;}
  const origin=request.headers.origin;
  if(origin===allowedOrigin){response.setHeader("Access-Control-Allow-Origin",allowedOrigin);response.setHeader("Vary","Origin");}
  if(request.method==="OPTIONS"){
    if(origin!==allowedOrigin){forbidden(response);return;}
    response.writeHead(204,{"Access-Control-Allow-Methods":"GET, HEAD, PUT, OPTIONS","Access-Control-Allow-Headers":"content-type, authorization, x-amz-content-sha256, x-amz-date, x-amz-security-token, x-amz-user-agent, x-amz-checksum-sha256, x-amz-sdk-checksum-algorithm","Access-Control-Max-Age":"300"});response.end();return;
  }
  let parsed;
  try{parsed=new URL(request.url||"/","http://localhost");if(!verify(request,parsed)){forbidden(response);return;}}
  catch{forbidden(response);return;}
  const upstream=http.request({hostname:targetHost,port:targetPort,method:request.method,path:request.url,headers:{...request.headers,host:request.headers.host}},upstreamResponse=>{
    const headers={...upstreamResponse.headers};
    if(origin===allowedOrigin)headers["access-control-allow-origin"]=allowedOrigin;
    response.writeHead(upstreamResponse.statusCode||502,headers);upstreamResponse.pipe(response);
  });
  upstream.on("error",()=>{if(!response.headersSent)response.writeHead(502);response.end();});
  request.pipe(upstream);
}).listen(9000,"0.0.0.0");
