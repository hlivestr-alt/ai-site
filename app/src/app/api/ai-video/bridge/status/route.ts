import { getBridgeStatus } from "@/lib/integrations/h3-bridge";

export const dynamic = "force-dynamic";
export async function GET() { return Response.json(await getBridgeStatus(), { headers: { "Cache-Control": "no-store" } }); }
