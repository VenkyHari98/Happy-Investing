import { NextResponse } from "next/server";
import data from "@/data/opportunities/s200_20pct_rallies.json";

export async function GET() {
  return NextResponse.json(data);
}
