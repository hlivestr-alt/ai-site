import { NextResponse } from "next/server";
import { getOutreachOverview } from "@/lib/integrations/outreach";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await getOutreachOverview(), { headers: { "Cache-Control": "no-store" } });
}
