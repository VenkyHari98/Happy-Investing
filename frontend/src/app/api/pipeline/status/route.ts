import { NextResponse } from "next/server";
import status from "@/data/opportunities/pipeline_status.json";

const OWNER = "VenkyHari98";
const REPO = "Happy-Investing";
const WORKFLOW = "refresh-opportunities.yml";

// Reflects the live GitHub Actions run state so the existing "refreshing…"
// polling UI (StaleBanner) keeps working without any frontend changes —
// running flips true right after a dispatch and back to false once the
// Action (and the Vercel redeploy it triggers) completes.
async function isRunning(): Promise<boolean> {
  if (!process.env.GH_DISPATCH_TOKEN) return false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "happy-investing-app",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return false;
    const data = await res.json();
    const run = data.workflow_runs?.[0];
    return run?.status === "queued" || run?.status === "in_progress";
  } catch {
    return false;
  }
}

export async function GET() {
  const running = await isRunning();
  return NextResponse.json({
    ...status,
    running,
    today: new Date().toISOString().slice(0, 10),
  });
}
