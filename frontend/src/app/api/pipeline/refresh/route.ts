import { NextResponse } from "next/server";

// Static deploy has no live pipeline process — "refresh" instead dispatches
// the scheduled GitHub Action (.github/workflows/refresh-opportunities.yml)
// on demand. Requires GH_DISPATCH_TOKEN (server-side only Vercel env var —
// a fine-grained PAT scoped to this repo with Actions: Read and write).
const OWNER = "VenkyHari98";
const REPO = "Happy-Investing";
const WORKFLOW = "refresh-opportunities.yml";
const COOLDOWN_MINUTES = 10;

function githubHeaders() {
  return {
    Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "happy-investing-app",
  };
}

async function latestRun() {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`,
    { headers: githubHeaders(), cache: "no-store" }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.workflow_runs?.[0] ?? null;
}

export async function POST() {
  if (!process.env.GH_DISPATCH_TOKEN) {
    return NextResponse.json({ ok: false, error: "Refresh trigger not configured." }, { status: 500 });
  }

  const run = await latestRun();
  if (run && (run.status === "queued" || run.status === "in_progress")) {
    return NextResponse.json(
      { ok: false, error: "A refresh is already running — check back in a few minutes." },
      { status: 409 }
    );
  }
  if (run) {
    const ageMin = (Date.now() - new Date(run.created_at).getTime()) / 60_000;
    if (ageMin < COOLDOWN_MINUTES) {
      const wait = Math.ceil(COOLDOWN_MINUTES - ageMin);
      return NextResponse.json(
        { ok: false, error: `A refresh ran recently — try again in ${wait} min.` },
        { status: 429 }
      );
    }
  }

  const dispatch = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    { method: "POST", headers: githubHeaders(), body: JSON.stringify({ ref: "main" }) }
  );
  if (!dispatch.ok) {
    return NextResponse.json({ ok: false, error: "Failed to trigger refresh." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
