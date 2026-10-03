import http from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { storageGatewayConfig, storageBrowserMethods, storageBrowserHeaders, storageExposedHeaders } from "./storage-gateway-config.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
const hmac=(key,value)=>createHmac("sha256",key).update(value).digest();
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const normal=value=>String(value).trim().replace(/\s+/g," ");
function forbidden(response){response.writeHead(403,{"Content-Type":"application/json"});response.end(JSON.stringify({error:"Valid signed S3 request required"}));}
function verify(request,parsed,config){
  // The tunnel must preserve Host. Forwarded headers are untrusted and never replace it.
  if(!config.allowedHosts.has(request.headers.host))return false;
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
  if(credential?.length!==5||credential[0]!==config.accessKey||credential[1]!==date.slice(0,8)||credential[2]!==config.region||credential[3]!=="s3"||credential[4]!=="aws4_request")return false;
  const signedHeaders=fields.SignedHeaders;
  if(!signedHeaders||!/^[-a-z0-9;]+$/.test(signedHeaders)||!signedHeaders.split(";").includes("host"))return false;
  const headers=signedHeaders.split(";");
  if(new Set(headers).size!==headers.length||headers.join(";")!==[...headers].sort().join(";"))return false;
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
  const key=hmac(hmac(hmac(hmac(`AWS4${config.secretKey}`,credential[1]),credential[2]),"s3"),"aws4_request");
  const expected=hmac(key,toSign).toString("hex");
  const actual=fields.Signature||"";
  return /^[a-f0-9]{64}$/.test(actual)&&timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(actual,"hex"));
}

/** @param {Record<string, string | undefined>} env */
export function createStorageGateway(env=process.env){
  const config=storageGatewayConfig(env);
  return http.createServer((request,response)=>{
    response.setHeader("Cache-Control","private, no-store");
    response.setHeader("Vary","Origin");
    if(!config.allowedHosts.has(request.headers.host)){forbidden(response);return;}
    if(request.url==="/health"&&request.method==="GET"&&config.internalHosts.has(request.headers.host)){
      response.writeHead(200,{"Content-Type":"text/plain"});response.end("ready");return;
    }
    const origin=request.headers.origin;
    if(origin&&!config.allowedOrigins.has(origin)){forbidden(response);return;}
    if(origin){
      response.setHeader("Access-Control-Allow-Origin",origin);
      response.setHeader("Access-Control-Expose-Headers",storageExposedHeaders.join(", "));
    }
    if(request.method==="OPTIONS"){
      const method=request.headers["access-control-request-method"];
      const headers=String(request.headers["access-control-request-headers"]||"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
      if(!origin||!storageBrowserMethods.includes(method)||headers.some(v=>!storageBrowserHeaders.includes(v))){forbidden(response);return;}
      response.writeHead(204,{"Access-Control-Allow-Methods":storageBrowserMethods.concat("OPTIONS").join(", "),"Access-Control-Allow-Headers":storageBrowserHeaders.join(", "),"Access-Control-Max-Age":"300"});response.end();return;
    }
    let parsed;
    try{parsed=new URL(request.url||"/","http://localhost");if(!verify(request,parsed,config)){forbidden(response);return;}}
    catch{forbidden(response);return;}
    const upstream=http.request({hostname:config.targetHost,port:config.targetPort,method:request.method,path:request.url,headers:{...request.headers,host:request.headers.host}},upstreamResponse=>{
      const headers={...upstreamResponse.headers};
      // Only this gateway controls browser CORS, even if the emulator returns permissive headers.
      for(const name of Object.keys(headers))if(name.startsWith("access-control-"))delete headers[name];
      headers.vary=[...new Set(String(headers.vary||"").split(",").map(v=>v.trim()).filter(Boolean).concat("Origin"))].join(", ");
      headers["cache-control"]="private, no-store";
      response.writeHead(upstreamResponse.statusCode||502,headers);upstreamResponse.pipe(response);
    });
    upstream.on("error",()=>{if(!response.headersSent)response.writeHead(502);response.end();});
    request.pipe(upstream);
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  createStorageGateway().listen(9000,"0.0.0.0");
}
