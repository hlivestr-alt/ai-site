export async function api<T>(path: string, method = "GET", input?: unknown): Promise<T> {
  const response = await fetch(path,{method,headers:input === undefined ? undefined : {"Content-Type":"application/json"},body:input === undefined ? undefined : JSON.stringify(input),cache:"no-store"});
  const data = await response.json().catch(() => ({})) as T & {error?:string};
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
