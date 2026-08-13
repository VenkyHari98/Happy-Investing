import { NextResponse } from "next/server";
import data from "@/data/opportunities/rhs_scanner_results.json";

export async function GET() {
  return NextResponse.json(data);
}
