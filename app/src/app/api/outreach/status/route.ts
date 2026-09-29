import { getOutreachSystemStatus } from "@/lib/integrations/outreach/status";

export const dynamic = "force-dynamic";
export async function GET() { return Response.json(await getOutreachSystemStatus(), { headers: { "Cache-Control": "no-store" } }); }
