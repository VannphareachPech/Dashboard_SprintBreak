"use client";

import { useState, useEffect, useRef } from "react";
import type { GeminiInsightsResponse, GeminiInsightRow } from "@/types/gemini";
import type { SummaryData, AreaScore, TrendPoint, RecommendationTheme, RoleSplitRow } from "@/types/dashboard";

type Priority = "High" | "Medium" | "Low";

// Retained for quick rollback if leadership wants the Priority column back.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PRIORITY_STYLES: Record<Priority, string> = {
  High:   "bg-rose-50 text-rose-700 ring-rose-200",
  Medium: "bg-amber-50 text-amber-700 ring-amber-200",
  Low:    "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

interface Props {
  cycle: string;
  summary: SummaryData;
  areaScores: AreaScore[];
  trends: TrendPoint[];
  recommendations: RecommendationTheme[];
  roleSplit?: RoleSplitRow[];
  comments?: string[];
}

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

function isGeminiInsightRow(value: unknown): value is GeminiInsightRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.roleGroupsMentioning !== "string" ||
    typeof row.insight !== "string" ||
    typeof row.recommendation !== "string"
  ) return false;
  if (row.mentionCount !== undefined && row.mentionCount !== null && typeof row.mentionCount !== "number") return false;
  return true;
}

function isGeminiInsightsResponse(value: unknown): value is GeminiInsightsResponse {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.summary === "string" &&
    Array.isArray(payload.rows) &&
    payload.rows.every(isGeminiInsightRow)
  );
}

function formatSavedDateUk(raw: string | undefined): string {
  const value = String(raw || "").trim();
  const ukFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year && month && day) {
      return ukFormatter.format(new Date(Date.UTC(year, month - 1, day)));
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return ukFormatter.format(parsed);
  }

  return value;
}

export default function GeminiInsights({ cycle, summary, areaScores, trends, recommendations, roleSplit, comments }: Props) {
  // Bump when the cached shape changes so stale entries are discarded automatically.
  const CACHE_SCHEMA_VERSION = 1;
  const cacheKey = `gemini_insights_v${CACHE_SCHEMA_VERSION}_${cycle}`;

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GeminiInsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0); // seconds remaining before next allowed click
  const [dailyQuotaExhausted, setDailyQuotaExhausted] = useState(false);
  const [hasExistingInsight, setHasExistingInsight] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const requestConfirmation = (dialog: ConfirmDialogState) => {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog(dialog);
    });
  };

  const resolveConfirmation = (confirmed: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    if (resolver) resolver(confirmed);
  };

  useEffect(() => {
    if (!loading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadingSeconds(0);
      return;
    }

    const timer = setInterval(() => {
      setLoadingSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [loading]);

  const loadingMessage =
    loadingSeconds < 4
      ? "Reading pulse data and preparing context..."
      : loadingSeconds < 9
      ? "Synthesising top themes across role groups..."
      : "Drafting clear, presentation-ready recommendations...";

  const pseudoProgress = Math.min(92, 18 + loadingSeconds * 5);

  // Load local cache first, then refresh from shared backend storage for this cycle.
  useEffect(() => {
    let canceled = false;

    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (isGeminiInsightsResponse(parsed)) {
          if (!canceled) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setResult(parsed);
            setHasExistingInsight(true);
          }
        } else {
          localStorage.removeItem(cacheKey);
        }
      }
    } catch { /* ignore parse errors */ }

    (async () => {
      try {
        const res = await fetch(`/api/gemini-insights?cycle=${encodeURIComponent(cycle)}`, { cache: "no-store" });
        const data = await res.json();
        if (canceled) return;

        if (data?.exists === false) {
          setResult(null);
          setHasExistingInsight(false);
          try { localStorage.removeItem(cacheKey); } catch { /* ignore */ }
          return;
        }

        if (!isGeminiInsightsResponse(data)) return;

        setResult(data);
        setHasExistingInsight(true);
        try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* ignore */ }
      } catch {
        // Ignore; cached data remains as the fallback.
      }
    })();

    return () => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
        confirmResolverRef.current = null;
      }
      canceled = true;
    };
  }, [cacheKey, cycle]);

  // Tick the cooldown counter down every second
  const startCooldown = (seconds: number) => {
    setCooldown(seconds);
    const interval = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  async function handleGenerate() {
    if (loading || cooldown > 0 || dailyQuotaExhausted) return;

    let forceRegenerate = false;
    if (hasExistingInsight || result) {
      const approved = await requestConfirmation({
        title: "Regenerate Insights?",
        message: "Insights already exist for this pulse. Regenerate only if survey data changed.",
        confirmLabel: "Regenerate",
        cancelLabel: "Keep Current",
      });
      if (!approved) return;
      forceRegenerate = true;
    }

    setLoading(true);
    setError(null);
    setDailyQuotaExhausted(false);

    try {
      const res = await fetch("/api/gemini-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycle,
          summary,
          areaScores,
          trends,
          recommendations,
          roleSplit,
          comments,
          forceRegenerate,
          confirmUnchanged: forceRegenerate,
          generatedBy: "Leadership",
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? "Unexpected error from Gemini API.");
        // Clear any stale localStorage cache so next attempt calls the API fresh
        try { localStorage.removeItem(cacheKey); } catch { /* ignore */ }
        if (res.status === 429) {
          if (data.dailyQuotaExhausted) {
            setDailyQuotaExhausted(true); // no point in retrying — quota is gone for today
          } else {
            startCooldown(data.retryAfter ?? 60);
          }
        }
      } else {
        if (!isGeminiInsightsResponse(data)) {
          setError("Gemini response format was invalid. Please try again.");
          try { localStorage.removeItem(cacheKey); } catch { /* ignore */ }
          return;
        }

        const insights = data;
        setResult(insights);
        setHasExistingInsight(true);
        // Persist to localStorage so server restarts don't force a re-call
        try { localStorage.setItem(cacheKey, JSON.stringify(insights)); } catch { /* quota full */ }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5 space-y-5">

      {/* Header + button */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-slate-700">AI-Generated Insights</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Powered by Gemini to produce theme-level recommendations grounded in role-group signals.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || cooldown > 0 || dailyQuotaExhausted}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              Generating…
            </>
          ) : cooldown > 0 ? (
            <>Retry in {cooldown}s</>
          ) : dailyQuotaExhausted ? (
            <>Quota Exhausted</>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {hasExistingInsight || result ? "Regenerate Insights" : "Generate Insights"}
            </>
          )}
        </button>
      </div>

      {result?.generatedAt && (
        <p className="text-xs text-slate-400">
          Saved for <span className="font-semibold text-slate-700">{cycle}</span> on {formatSavedDateUk(result.generatedAt)}.
        </p>
      )}

      {loading && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 px-4 py-3">
          <div className="flex items-start gap-3">
            <svg className="h-4 w-4 mt-0.5 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-indigo-900">Generating insights</p>
              <p className="text-xs text-indigo-800">{loadingMessage}</p>
              <div className="h-1.5 w-full rounded-full bg-indigo-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-700 ease-out"
                  style={{ width: `${pseudoProgress}%` }}
                />
              </div>
              <p className="text-[11px] text-indigo-700">
                {loadingSeconds >= 15
                  ? "Still working. This can take up to 30-45 seconds during peak usage."
                  : "Usually completes in under 30 seconds."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm space-y-1 ${
            dailyQuotaExhausted ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-rose-50 border-rose-200 text-rose-700"
          }`}
        >
          <p>{dailyQuotaExhausted
            ? "Daily API quota exhausted for this key."
            : error}
          </p>
          {dailyQuotaExhausted && (
            <p className="text-xs">
              Get a free replacement key at{" "}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer"
                className="underline font-medium">aistudio.google.com/app/apikey</a>
              , then update <code className="font-mono bg-amber-100 px-1 rounded">GEMINI_API_KEY</code> in{" "}
              <code className="font-mono bg-amber-100 px-1 rounded">.env.local</code> and restart the server.
            </p>
          )}
        </div>
      )}

      {/* Table */}
      {Array.isArray(result?.rows) && result.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-4 py-2.5 font-semibold text-slate-600 border-b border-slate-200 w-[30%]">Role Groups Mentioning</th>
                <th className="px-4 py-2.5 font-semibold text-slate-600 border-b border-slate-200 w-[20%]">Insight</th>
                <th className="px-4 py-2.5 font-semibold text-slate-600 border-b border-slate-200 w-[50%]">Recommendation</th>
                {/* Keep priority header for quick rollback if business wants it back.
                <th className="px-4 py-2.5 font-semibold text-slate-600 border-b border-slate-200 text-center w-[90px]">Priority</th>
                */}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row: GeminiInsightRow, i: number) => (
                <tr key={`${row.insight}-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-4 py-3 font-medium text-slate-700 border-b border-slate-100 align-top">
                    {String(row.roleGroupsMentioning).replace(/,([^\s])/g, ", $1")}
                  </td>
                  <td className="px-4 py-3 text-slate-600 border-b border-slate-100 align-top">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{row.insight}</span>
                      {typeof row.mentionCount === "number" && row.mentionCount >= 2 && (
                        <span
                          title={`Raised by ${row.mentionCount} employees (verified from similar comments)`}
                          className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200 whitespace-nowrap"
                        >
                          {row.mentionCount} employees
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 border-b border-slate-100 align-top">
                    {row.recommendation}
                  </td>
                  {/* Keep priority cell for quick rollback if business wants it back.
                  <td className="px-4 py-3 border-b border-slate-100 align-top text-center">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${PRIORITY_STYLES[row.priority as Priority] ?? PRIORITY_STYLES.Low}`}
                    >
                      {row.priority}
                    </span>
                  </td>
                  */}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state before first generation */}
      {!result && !loading && !error && (
        <p className="text-sm text-slate-400 text-center py-6">
          Click <span className="font-medium text-slate-600">Generate Insights</span> to analyse this pulse with Gemini.
        </p>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Close dialog"
            onClick={() => resolveConfirmation(false)}
          />
          <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="px-5 py-4 border-b border-slate-100">
              <h4 className="text-base font-semibold text-slate-800">{confirmDialog.title}</h4>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-600 leading-relaxed">{confirmDialog.message}</p>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => resolveConfirmation(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {confirmDialog.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => resolveConfirmation(true)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
