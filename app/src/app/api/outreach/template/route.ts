import { nativeMessageTemplate } from "@/lib/integrations/outreach/template";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ messageTemplate: await nativeMessageTemplate() }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Unable to load outreach message template." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
