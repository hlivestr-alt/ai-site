import { nativeRecipients } from "@/lib/integrations/outreach/write";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ recipients: await nativeRecipients((await context.params).id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Recipient preview unavailable" }, { status: 502 }); }
}
