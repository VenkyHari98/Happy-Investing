import { NextResponse } from "next/server";
import data from "@/data/opportunities/support_resistance.json";

export async function GET() {
  return NextResponse.json(data);
}
