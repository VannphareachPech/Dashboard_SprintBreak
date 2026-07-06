"use client";

import type { ResponseMixRow } from "@/types/dashboard";

interface Props {
  data: ResponseMixRow[];
}

type SentimentLevel = "strong" | "watch" | "concern";

function getSentiment(positive: number): SentimentLevel {
  if (positive >= 65) return "strong";
  if (positive >= 50) return "watch";
  return "concern";
}

const SENTIMENT_CONFIG: Record<
  SentimentLevel,
  { label: string; pill: string; badge: string }
> = {
  strong:  { label: "Strong",  pill: "bg-emerald-50 text-emerald-600 ring-emerald-100", badge: "text-emerald-600" },
  watch:   { label: "Watch",   pill: "bg-amber-50 text-amber-600 ring-amber-100",       badge: "text-amber-600"  },
  concern: { label: "Concern", pill: "bg-rose-50 text-rose-600 ring-rose-100",          badge: "text-rose-600"   },
};

export default function ResponseMixChart({ data }: Props) {
  if (!data || data.length === 0) return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5">
      <h3 className="text-lg font-semibold text-slate-700">Sentiment Breakdown by Area</h3>
      <p className="text-sm text-slate-400 mt-3">No sentiment data available yet.</p>
    </div>
  );

  const sorted = [...data].sort((a, b) => b.positive - a.positive);
  const sampleN = sorted[0]?.total ?? 0;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-700">Sentiment Breakdown by Area</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Share of positive, mixed, and negative responses per engagement driver · Based on {sampleN} responses
          </p>
        </div>

        {/* Compact legend */}
        <div className="flex items-center gap-3 text-[11px] text-slate-500 shrink-0">
          {[
            { color: "bg-emerald-300", label: "Positive" },
            { color: "bg-amber-200",   label: "Mixed"    },
            { color: "bg-rose-200",    label: "Negative" },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-sm shrink-0 ${color}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-3">
        {sorted.map((row) => {
          const level = getSentiment(row.positive);
          const cfg   = SENTIMENT_CONFIG[level];

          const primaryKey =
            level === "strong" ? "positive" : level === "watch" ? "mixed" : "negative";

          const displayValue =
            level === "strong"
              ? row.positive
              : level === "watch"
              ? row.mixed
              : row.negative;

          const secondary = [
            { key: "positive", value: row.positive, label: "Pos" },
            { key: "mixed", value: row.mixed, label: "Mix" },
            { key: "negative", value: row.negative, label: "Neg" },
          ]
            .filter((item) => item.key !== primaryKey && item.value > 0)
            .sort((a, b) => b.value - a.value)[0];

          return (
            <div
              key={row.area}
              className="group rounded-md px-2 py-2.5 -mx-2 hover:bg-slate-50 transition-colors duration-100"
            >
              {/* Area name + stats row */}
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm text-slate-600 font-medium truncate">{row.area}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Inline secondary metric (dynamic by dominant status), hover-only. */}
                  {secondary && (
                    <span className="text-[11px] text-slate-500 tabular-nums hidden group-hover:inline">
                      {secondary.label} {secondary.value}%
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cfg.pill}`}
                  >
                    {cfg.label}
                  </span>
                  <span className={`text-xs font-semibold tabular-nums w-8 text-right ${cfg.badge}`}>
                    {displayValue}%
                  </span>
                </div>
              </div>

              {/* Thin 3-segment bar */}
              <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-slate-100">
                {row.positive > 0 && (
                  <div
                    className="h-full bg-emerald-300 transition-all duration-300"
                    style={{ width: `${row.positive}%` }}
                    title={`Positive: ${row.positive}%`}
                  />
                )}
                {row.mixed > 0 && (
                  <div
                    className="h-full bg-amber-200 transition-all duration-300"
                    style={{ width: `${row.mixed}%` }}
                    title={`Mixed: ${row.mixed}%`}
                  />
                )}
                {row.negative > 0 && (
                  <div
                    className="h-full bg-rose-200 transition-all duration-300"
                    style={{ width: `${row.negative}%` }}
                    title={`Negative: ${row.negative}%`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}