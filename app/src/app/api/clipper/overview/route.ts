import { NextResponse } from "next/server";
import { getClipperOverview } from "@/lib/integrations/clipper";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await getClipperOverview(), { headers: { "Cache-Control": "no-store" } });
}
