import { bridgeUrl } from "@/lib/integrations/h3-bridge";
import { validJobId } from "@/lib/integrations/h3-bridge/jobs";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validJobId(id)) return new Response(null, { status: 404 });
  try {
    const headers = new Headers();
    const range = request.headers.get("range"); if (range) headers.set("Range", range);
    const response = await fetch(`${bridgeUrl()}/jobs/${id}/artifact`, { method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) return new Response(null, { status: response.status === 409 ? 409 : 404 });
    const result = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-length", "content-range", "accept-ranges"]) { const value = response.headers.get(name); if (value) result.set(name, value); }
    return new Response(response.body, { status: response.status, headers: result });
  } catch { return new Response(null, { status: 503 }); }
}
