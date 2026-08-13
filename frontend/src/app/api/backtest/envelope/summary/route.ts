import { NextResponse } from "next/server";

// Static deploy has no live envelope backtest — the scanner tab only needs
// this one number (matches the frontend's own `?? 14` fallback default).
export async function GET() {
  return NextResponse.json({ envelope_pct: 14 });
}
