import { NextResponse } from "next/server";
import data from "@/data/opportunities/current_setup_summary.json";

export async function GET() {
  return NextResponse.json(data);
}
