import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { GeminiInsightsResponse } from "@/types/gemini";

type RoleSplitRowLike = {
  area?: string;
  scores?: Record<string, number>;
  roleGap?: number;
};

type StoredInsightEnvelope = {
  ok?: boolean;
  exists?: boolean;
  found?: boolean;
  // flat shape returned by Apps Script getAiInsightResponse_
  summary?: string;
  rows?: unknown[];
  dataFingerprint?: string;
  generatedBy?: string;
  updatedAt?: string;
  // nested shape (legacy / alternative deployment)
  insight?: {
    summary?: string;
    rows?: unknown[];
    generatedAt?: string;
    generatedBy?: string;
    dataFingerprint?: string;
  };
};

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;

function buildDataFingerprint(payload: {
  cycle: unknown;
  summary: unknown;
  areaScores: unknown;
  trends: unknown;
  recommendations: unknown;
  roleSplit: unknown;
}) {
  const raw = JSON.stringify({
    cycle: payload.cycle,
    summary: payload.summary,
    areaScores: payload.areaScores,
    trends: payload.trends,
    recommendations: payload.recommendations,
    roleSplit: payload.roleSplit,
  });
  return createHash("sha256").update(raw).digest("hex");
}

async function fetchStoredInsight(cycle: string) {
  if (!APPS_SCRIPT_URL || !cycle) return null;

  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", "getAiInsight");
  url.searchParams.set("cycle", cycle);
  if (APPS_SCRIPT_SECRET) url.searchParams.set("secret", APPS_SCRIPT_SECRET);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const payload = await res.json() as StoredInsightEnvelope;
    // Support both flat shape { found, summary, rows } and nested { exists, insight: { ... } }
    const isFound = payload?.found === true || payload?.exists === true;
    if (!isFound) return null;

    const summary = String(payload.summary || payload.insight?.summary || "").trim();
    const rows = Array.isArray(payload.rows) ? payload.rows
      : Array.isArray(payload.insight?.rows) ? payload.insight.rows
      : [];
    if (!summary || rows.length === 0) return null;

    const generatedAt = String(payload.updatedAt || payload.insight?.generatedAt || "").trim() || undefined;
    const generatedBy = String(payload.generatedBy || payload.insight?.generatedBy || "").trim() || undefined;
    const dataFingerprint = String(payload.dataFingerprint || payload.insight?.dataFingerprint || "").trim() || undefined;

    return {
      summary,
      rows,
      generatedAt,
      generatedBy,
      dataFingerprint,
    };
  } catch {
    return null;
  }
}

async function persistInsight(args: {
  cycle: string;
  summary: string;
  rows: unknown[];
  dataFingerprint: string;
  generatedBy: string;
  force: boolean;
}) {
  if (!APPS_SCRIPT_URL || !args.cycle) return null;

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        action: "upsertAiInsight",
        cycle: args.cycle,
        summary: args.summary,
        rows: args.rows,
        dataFingerprint: args.dataFingerprint,
        generatedBy: args.generatedBy,
        force: args.force,
        secret: APPS_SCRIPT_SECRET,
      }),
    });
    if (!res.ok) return null;
    return await res.json() as {
      ok?: boolean;
      alreadyExists?: boolean;
      unchangedData?: boolean;
      insight?: {
        generatedAt?: string;
        generatedBy?: string;
      };
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const cycle = String(req.nextUrl.searchParams.get("cycle") || "").trim();
  if (!cycle) {
    return NextResponse.json({ exists: false });
  }

  const stored = await fetchStoredInsight(cycle);
  if (!stored) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    summary: stored.summary,
    rows: stored.rows,
    fromStorage: true,
    generatedAt: stored.generatedAt,
    generatedBy: stored.generatedBy,
  });
}

function classifyDelta(delta: unknown) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return "unknown";
  if (delta <= -0.2) return "declining";
  if (delta >= 0.2) return "improving";
  if (delta > -0.1 && delta < 0.1) return "stable";
  return delta < 0 ? "softening" : "rising";
}

function classifyPriorityBand(score: unknown, pulsesAtRisk: unknown) {
  const safeScore = typeof score === "number" && Number.isFinite(score) ? score : null;
  const safeRisk = typeof pulsesAtRisk === "number" && Number.isFinite(pulsesAtRisk) ? pulsesAtRisk : 0;

  if ((safeScore != null && safeScore < 3.5) || safeRisk >= 2) return "critical";
  if (safeScore != null && safeScore < 4) return "watch";
  return "strong";
}

// ── In-memory cache — keyed by cycle label ────────────────────────────────────
const responseCache = new Map<string, GeminiInsightsResponse>();

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    cycle,
    summary,
    areaScores,
    trends,
    recommendations,
    roleSplit,
    forceRegenerate,
    generatedBy,
  } = body;

  const force = Boolean(forceRegenerate);
  const fingerprint = buildDataFingerprint({ cycle, summary, areaScores, trends, recommendations, roleSplit });

  const safeCycle = String(cycle || "").trim();

  if (safeCycle) {
    const stored = await fetchStoredInsight(safeCycle);
    const unchanged = !!(stored && stored.dataFingerprint && stored.dataFingerprint === fingerprint);

    if (stored && unchanged) {
      const persisted: GeminiInsightsResponse = {
        summary: stored.summary,
        rows: Array.isArray(stored.rows) ? (stored.rows as GeminiInsightsResponse["rows"]) : [],
        alreadyExists: true,
        fromStorage: true,
        unchangedData: true,
        generatedAt: stored.generatedAt,
        generatedBy: stored.generatedBy,
      };
      responseCache.set(safeCycle, persisted);
      return NextResponse.json(persisted);
    }

    if (stored && !force) {
      const persisted: GeminiInsightsResponse = {
        summary: stored.summary,
        rows: Array.isArray(stored.rows) ? (stored.rows as GeminiInsightsResponse["rows"]) : [],
        alreadyExists: true,
        fromStorage: true,
        unchangedData: false,
        generatedAt: stored.generatedAt,
        generatedBy: stored.generatedBy,
      };
      responseCache.set(safeCycle, persisted);
      return NextResponse.json(persisted);
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not configured." }, { status: 500 });
  }

  // Return cached result immediately — no API call
  if (safeCycle && responseCache.has(safeCycle) && !force) {
    return NextResponse.json(responseCache.get(safeCycle));
  }

  const safeResponses = Number(summary?.totalResponses) || 0;
  const safeTeamSize = Number(summary?.teamSize) || 0;
  const participationRate = safeTeamSize > 0
    ? Math.round((safeResponses / safeTeamSize) * 100)
    : null;
  const sampleConfidence =
    safeResponses >= 60 ? "high" :
    safeResponses >= 30 ? "medium" :
    "low";

  const areaLines = (areaScores as any[])
    .map((area) => {
      const trend = classifyDelta(area.delta);
      const band = classifyPriorityBand(area.score, area.pulsesAtRisk);
      return `${area.area}=score:${area.score}|trend:${trend}|band:${band}`;
    })
    .join("; ");

  const riskAreas = (areaScores as any[])
    .map((area) => ({
      area: String(area?.area || "").trim(),
      score: Number(area?.score),
      pulsesAtRisk: Number(area?.pulsesAtRisk) || 0,
      band: classifyPriorityBand(area?.score, area?.pulsesAtRisk),
    }))
    .filter((area) => area.area && Number.isFinite(area.score))
    .filter((area) => area.band === "critical" || area.pulsesAtRisk >= 2 || area.score < 3.5)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((area) => `${area.area}(score=${area.score.toFixed(1)}${area.pulsesAtRisk ? `,riskCount=${area.pulsesAtRisk}` : ""})`)
    .join(", ");

  const trendLine = (trends as any[]).slice(-3).map((t) => `${t.cycle}:${t.overallScore}`).join(", ");
  const recentTrends = (trends as any[]).slice(-3);
  const prevOverall = recentTrends.length >= 2 ? Number(recentTrends[recentTrends.length - 2]?.overallScore) : NaN;
  const currentOverall = recentTrends.length >= 1
    ? Number(recentTrends[recentTrends.length - 1]?.overallScore)
    : Number(summary?.overallScore);
  const trendDelta = Number.isFinite(prevOverall) && Number.isFinite(currentOverall)
    ? Math.round((currentOverall - prevOverall) * 10) / 10
    : null;
  const trendDirection = classifyDelta(trendDelta);

  const signalLines = (recommendations as any[]).slice(0, 5)
    .map((recommendation) => `${recommendation.theme}:${recommendation.frequency}x${recommendation.areaLink ? `[${recommendation.areaLink}]` : ""}`)
    .join(", ");

  const roleHotspots = (Array.isArray(roleSplit) ? roleSplit as RoleSplitRowLike[] : [])
    .map((row): { area: string; roleGap: number | null; text: string } | null => {
      const area = String(row.area || "").trim();
      const scores = row.scores || {};
      const groups = Object.entries(scores)
        .filter(([, score]) => Number.isFinite(score))
        .sort((a, b) => a[1] - b[1]);
      const lowestGroups = groups
        .slice(0, Math.min(2, groups.length))
        .map(([name, score]) => `${name}(${score.toFixed(1)})`)
        .join(", ");
      if (!area || !lowestGroups) return null;
      const roleGap = typeof row.roleGap === "number" ? row.roleGap : null;
      return {
        area,
        roleGap,
        text: `${area}: lowest=${lowestGroups}${roleGap != null ? `, roleGap=${roleGap.toFixed(1)}` : ""}`,
      };
    })
    .filter((item): item is { area: string; roleGap: number | null; text: string } => item !== null)
    .sort((a, b) => (b.roleGap ?? 0) - (a.roleGap ?? 0))
    .slice(0, 3);

  const roleSplitLines = roleHotspots.map((x) => x.text).join("; ");

  const prompt = `Team pulse data (structured facts):
pulseMeta: cycle=${cycle}, overallScore=${summary.overallScore}/5, overallStatus=${summary.overallStatus}, totalResponses=${summary.totalResponses}, participationRate=${participationRate != null ? `${participationRate}%` : "n/a"}, sampleConfidence=${sampleConfidence}
trend: recentOverall=${trendLine || "none"}, deltaFromPrevious=${trendDelta != null ? (trendDelta > 0 ? `+${trendDelta}` : `${trendDelta}`) : "n/a"}, trendDirection=${trendDirection}
focus: strongestArea=${summary.highestArea}, weakestArea=${summary.lowestArea}, riskAreas=${riskAreas || "none"}
themes: ${signalLines || "none"}
roleHotspots: ${roleSplitLines || "none"}
areaScores: ${areaLines || "none"}

Return ONLY this JSON (no markdown):
{"summary":"<2 sentences>","rows":[{"roleGroupsMentioning":"<comma-separated groups>","insight":"<theme label>","recommendation":"<1 sentence>"}]}

Rules:
- Return at most 5 rows.
- Use theme-level insights, not area names as insight labels.
- roleGroupsMentioning must use only role names from role split data when available. If a theme applies broadly with no specific group, use "All Groups". This field must never be empty.
- Prioritize themes with broader cross-role impact and frequent recurrence in Signals.
- Write in business presentation tone: clear, concise, executive-friendly, and non-technical.
- If sampleConfidence is low, use cautious wording and avoid broad claims.
- summary must be exactly 2 sentences:
  sentence 1: current state and strongest signal.
  sentence 2: biggest risk and immediate focus.
- insight should be short and presentation-ready (2 to 6 words, title case preferred).
- recommendation must be one sentence, action-led, specific owner or team implied, and framed in business outcomes.
- Prefer impact language such as delivery predictability, decision velocity, quality, risk reduction, customer value, or team sustainability.
- Do NOT mention numeric score deltas or "point gap" by default.
- Mention a numeric gap only when it is essential and high severity (for example roleGap >= 1.5 or critical risk signal), and even then keep it brief.
- Avoid filler words, hedging, and jargon (for example: "maybe", "might", "leverage", "synergy").
- mention strongest area and biggest risk in summary.`;

  try {
    // Use gemini-2.5-flash — works with this project's free tier quota
    // Retry up to 3 times on 503 (temporary overload), but never on 429
    let geminiRes: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 4096,
              topP: 0.8,
            },
          }),
        }
      );
      if (geminiRes.status !== 503) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
    }

    if (!geminiRes) {
      return NextResponse.json({ error: "Failed to reach Gemini API." }, { status: 502 });
    }

    if (geminiRes.status === 503) {
      return NextResponse.json(
        { error: "Gemini is temporarily overloaded. Please try again in a few seconds." },
        { status: 503 }
      );
    }

    if (geminiRes.status === 429) {
      let retryAfter = 60;
      let dailyQuotaExhausted = false;
      try {
        const errBody = await geminiRes.json();
        console.error("[gemini-insights] 429 body:", JSON.stringify(errBody));
        // Check if daily quota is exhausted (vs per-minute rate limit)
        const violations: any[] = errBody?.error?.details?.find((d: any) => d.violations)?.violations ?? [];
        dailyQuotaExhausted = violations.some((v: any) => v.quotaId?.toLowerCase().includes("perday"));
        const delayStr: string | undefined = errBody?.error?.details?.find((d: any) => d.retryDelay)?.retryDelay;
        if (delayStr) retryAfter = Math.max(parseInt(delayStr.replace(/\D/g, ""), 10) || 60, 5);
      } catch { /* ignore */ }
      const error = dailyQuotaExhausted
        ? "Daily Gemini quota exhausted. Get a new free API key at aistudio.google.com/app/apikey and update GEMINI_API_KEY in .env.local."
        : "Gemini rate limit reached. Please wait a moment and try again.";
      return NextResponse.json({ error, retryAfter, dailyQuotaExhausted }, { status: 429 });
    }

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return NextResponse.json({ error: `Gemini API error: ${geminiRes.status} — ${err}` }, { status: 502 });
    }

    const geminiData = await geminiRes.json();

    // Log full response in dev to diagnose format issues
    console.log("[gemini-insights] raw response:", JSON.stringify(geminiData).slice(0, 600));

    const candidate = geminiData?.candidates?.[0];
    const finishReason: string = candidate?.finishReason ?? "";

    // Handle safety blocks or empty candidates
    if (!candidate || finishReason === "SAFETY" || finishReason === "BLOCKED") {
      console.error("[gemini-insights] Blocked or empty candidate:", finishReason);
      return NextResponse.json({ error: "Gemini blocked the response. Try again." }, { status: 502 });
    }

    // gemini-2.5-flash uses a "thought" part + final text part; grab last non-empty text part
    const parts: Array<{ text?: string }> = candidate?.content?.parts ?? [];
    const rawText: string = [...parts].reverse().find((p) => p.text?.trim())?.text ?? "";

    if (!rawText) {
      console.error("[gemini-insights] Empty text in candidate. finishReason:", finishReason, "parts:", JSON.stringify(parts).slice(0, 200));
      return NextResponse.json({ error: "Gemini returned an empty response. Please try again." }, { status: 502 });
    }

    // Strip markdown fences
    const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    // Extract the JSON object even if the model added extra text around it
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[gemini-insights] No JSON object found in response:", cleaned.slice(0, 400));
      return NextResponse.json({ error: "Gemini returned an unexpected format. Please try again." }, { status: 502 });
    }

    let parsed: GeminiInsightsResponse;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error("[gemini-insights] JSON parse failed:", jsonMatch[0].slice(0, 300));
      return NextResponse.json({ error: "Gemini response was malformed. Please try again." }, { status: 502 });
    }

    // Deterministic sorting: breadth of role-group impact first, then signal frequency, then insight name.
    const signalFrequencyMap = new Map<string, number>();
    (recommendations as any[]).forEach((rec) => {
      const key = String(rec?.theme || "").trim().toLowerCase();
      const freq = Number(rec?.frequency) || 0;
      if (key) signalFrequencyMap.set(key, freq);
    });

    const countRoleGroups = (text: string) =>
      String(text || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean).length;

    parsed.rows = (parsed.rows || [])
      .filter((row) => row && row.insight && row.recommendation && String(row.roleGroupsMentioning || "").trim())
      .sort((a, b) => {
        const aGroups = countRoleGroups(a.roleGroupsMentioning);
        const bGroups = countRoleGroups(b.roleGroupsMentioning);
        if (bGroups !== aGroups) return bGroups - aGroups;

        const aFreq = signalFrequencyMap.get(String(a.insight || "").trim().toLowerCase()) || 0;
        const bFreq = signalFrequencyMap.get(String(b.insight || "").trim().toLowerCase()) || 0;
        if (bFreq !== aFreq) return bFreq - aFreq;

        return String(a.insight || "").localeCompare(String(b.insight || ""));
      })
      .slice(0, 5);

    let persistedGeneratedAt: string | undefined;
    let persistedGeneratedBy: string | undefined;

    if (safeCycle) {
      const saveResult = await persistInsight({
        cycle: safeCycle,
        summary: parsed.summary,
        rows: parsed.rows,
        dataFingerprint: fingerprint,
        generatedBy: String(generatedBy || "Dashboard UI").trim() || "Dashboard UI",
        force,
      });
      persistedGeneratedAt = String(saveResult?.insight?.generatedAt || "").trim() || undefined;
      persistedGeneratedBy = String(saveResult?.insight?.generatedBy || "").trim() || undefined;
    }

    const responsePayload: GeminiInsightsResponse = {
      ...parsed,
      fromStorage: false,
      unchangedData: false,
      generatedAt: persistedGeneratedAt,
      generatedBy: persistedGeneratedBy,
    };

    if (safeCycle) responseCache.set(safeCycle, responsePayload);

    return NextResponse.json(responsePayload);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
