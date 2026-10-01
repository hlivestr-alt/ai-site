export async function api<T>(path: string, method = "GET", input?: unknown): Promise<T> {
  let response:Response;
  try{response=await fetch(path,{method,headers:input === undefined ? undefined : {"Content-Type":"application/json"},body:input === undefined ? undefined : JSON.stringify(input),cache:"no-store",signal:AbortSignal.timeout(180000)});}catch{throw new Error('The service did not respond. Refresh the current status before retrying.');}
  const data = await response.json().catch(() => ({})) as T & {error?:string;requestId?:string};
  if (!response.ok) throw new Error((data.error || "Request failed.")+(response.status>=500&&data.requestId?` Support reference: ${data.requestId}`:''));
  return data;
}
