import type { DashboardData, TrendPoint } from "@/types/dashboard";

export type DashboardFetchErrorCode =
  | "MISSING_URL"
  | "HTTP_ERROR"
  | "NON_JSON_RESPONSE"
  | "INVALID_PAYLOAD"
  | "NETWORK_ERROR";

export interface DashboardFetchError {
  code: DashboardFetchErrorCode;
  message: string;
  details?: string;
}

export interface DashboardFetchResult {
  data: DashboardData | null;
  error: DashboardFetchError | null;
}

function scoreToOverallStatus(score: number): string {
  // Keep UI status consistent with the displayed hero score.
  if (score >= 4.0) return "Strong";
  if (score >= 3.5) return "Stable";
  if (score >= 3.0) return "Watch";
  return "At Risk";
}

function normalizeTrendList(raw: unknown): TrendPoint[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => item as Partial<TrendPoint>)
    .map((t) => ({
      ...t,
      cycle: String(t.cycle || "").trim(),
      overallScore: Number(t.overallScore) || 0,
    }))
    .filter((t) => t.cycle.length > 0 && t.overallScore > 0);
}

function hasUsablePulseHistory(trends: TrendPoint[]): boolean {
  if (trends.length < 2) return false;
  return trends.every((t) => !/unknown/i.test(String(t.cycle || "")));
}

export async function fetchDashboardData(): Promise<DashboardFetchResult> {
  const baseUrl = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  const isDev = process.env.NODE_ENV !== "production";
  const requestTimeoutMs = 30000;
  // Page uses `dynamic = "force-dynamic"`, so per-request caching is intentionally
  // off. `no-store` here documents that behaviour explicitly (was previously
  // `revalidate: 300` which never took effect and was misleading).
  const nextCacheOptions = { cache: "no-store" } as const;

  if (!baseUrl) {
    return {
      data: null,
      error: {
        code: "MISSING_URL",
        message: "APPS_SCRIPT_URL is not configured.",
      },
    };
  }

  // Warn (loudly) when the shared secret is missing in production so operators
  // notice the fail-closed condition instead of silently deploying an endpoint
  // that will reject every request.
  if (!isDev && !secret) {
    console.warn(
      "[fetchDashboardData] APPS_SCRIPT_SECRET is not set. The Apps Script " +
        "endpoint will reject all requests (fail-closed) until this matches " +
        "the API_SHARED_SECRET Script Property in Apps Script."
    );
  }

  const url = secret
    ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}secret=${encodeURIComponent(secret)}`
    : baseUrl;

  try {
    async function fetchWithTimeout(): Promise<Response> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        return await fetch(url, {
          ...nextCacheOptions,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    }

    let res: Response;
    try {
      res = await fetchWithTimeout();
    } catch (firstErr) {
      // Apps Script can spike on cold starts; retry once on timeout/abort.
      if (firstErr instanceof Error && firstErr.name === "AbortError") {
        res = await fetchWithTimeout();
      } else {
        throw firstErr;
      }
    }

    if (!res.ok) {
      console.error(`Apps Script fetch failed: ${res.status}`);
      return {
        data: null,
        error: {
          code: "HTTP_ERROR",
          message: "Apps Script endpoint returned a non-OK response.",
          details: `HTTP ${res.status}`,
        },
      };
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const raw = await res.text();

    if (!raw.trim().startsWith("{") && !raw.trim().startsWith("[")) {
      console.error(
        "Apps Script did not return JSON. Check deployment access (Anyone with the link) and endpoint URL.",
        {
          contentType,
          preview: raw.slice(0, 180),
        }
      );
      return {
        data: null,
        error: {
          code: "NON_JSON_RESPONSE",
          message: "Apps Script did not return JSON.",
          details: contentType || "Unknown content type",
        },
      };
    }

    const data = JSON.parse(raw) as Partial<DashboardData>;

    const liveTrends = normalizeTrendList(data.trends);
    const trends = hasUsablePulseHistory(liveTrends) ? liveTrends : [];
    const latestTrendScore =
      trends.length > 0
        ? Number(trends[trends.length - 1].overallScore) || 0
        : 0;
    const rawScore = Number((data.summary || {}).overallScore);
    // Source of truth is latest trend point when available; fallback to summary.
    const resolvedScore = latestTrendScore > 0 ? latestTrendScore : rawScore;
    const resolvedStatus = scoreToOverallStatus(resolvedScore);

    if (!data.summary || !Array.isArray(data.areaScores) || data.areaScores.length === 0) {
      console.error(
        "Apps Script returned JSON but summary/areaScores are missing or empty. Raw response preview:",
        raw.slice(0, 500)
      );
      return {
        data: null,
        error: {
          code: "INVALID_PAYLOAD",
          message: "Dashboard payload is missing required fields.",
        },
      };
    }

    const normalized: DashboardData = {
      cycle: String(data.cycle || "").trim() || "Unknown",
      generatedDate: String(data.generatedDate || "").trim() || new Date().toISOString().split("T")[0],
      narrativeSummary: data.narrativeSummary,
      summary: {
        totalResponses: Number((data.summary || {}).totalResponses) || 0,
        highestArea: String((data.summary || {}).highestArea || ""),
        lowestArea: String((data.summary || {}).lowestArea || ""),
        overallStatus: resolvedStatus,
        overallScore: resolvedScore,
        teamSize: Number((data.summary || {}).teamSize) || undefined,
      },
      areaScores: Array.isArray(data.areaScores) ? data.areaScores : [],
      trends,
      recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
      actions: Array.isArray(data.actions) ? data.actions : [],
      responseCurrentRawData: Array.isArray(data.responseCurrentRawData) && data.responseCurrentRawData.length > 0
        ? data.responseCurrentRawData
        : undefined,
      responseAllRawData: Array.isArray(data.responseAllRawData) && data.responseAllRawData.length > 0
        ? data.responseAllRawData
        : undefined,
      roleSplit: Array.isArray(data.roleSplit) && data.roleSplit.length > 0
        ? data.roleSplit
        : undefined,
      responseCounts: Array.isArray(data.responseCounts) && data.responseCounts.length > 0
        ? data.responseCounts
        : undefined,
      responseMix: Array.isArray(data.responseMix) && data.responseMix.length > 0
        ? data.responseMix
        : undefined,
      comments: Array.isArray(data.comments) && data.comments.length > 0
        ? (data.comments as string[])
        : undefined,
    };

    const trendList = normalized.trends;
    if (trendList.length >= 2) {
      normalized.summary.scoreDelta = +(
        trendList[trendList.length - 1].overallScore -
        trendList[trendList.length - 2].overallScore
      ).toFixed(1);
    } else {
      normalized.summary.scoreDelta = undefined;
    }

    return {
      data: normalized,
      error: null,
    };
  } catch (err) {
    console.error("fetchDashboardData error:", err);
    return {
      data: null,
      error: {
        code: "NETWORK_ERROR",
        message: "Failed to reach Apps Script endpoint.",
        details: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
