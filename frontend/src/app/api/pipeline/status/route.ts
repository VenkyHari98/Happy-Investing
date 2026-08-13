import { NextResponse } from "next/server";
import status from "@/data/opportunities/pipeline_status.json";

export async function GET() {
  return NextResponse.json({
    ...status,
    today: new Date().toISOString().slice(0, 10),
  });
}
