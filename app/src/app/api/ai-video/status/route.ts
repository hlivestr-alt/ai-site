import { NextResponse } from "next/server";
import { getH3ConnectionStatus } from "@/lib/integrations/h3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getH3ConnectionStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
