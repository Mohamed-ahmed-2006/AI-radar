import { NextResponse } from "next/server";
import { getSentinelDashboardReadModel } from "@/lib/sentinel";

export async function GET() {
  try {
    const data = await getSentinelDashboardReadModel();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch sentinel source health";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
