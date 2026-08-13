import { NextResponse } from "next/server";
import data from "@/data/opportunities/current_setup.json";

export async function GET() {
  return NextResponse.json(data);
}
