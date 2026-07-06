interface FocusAreaProps {
  area: string;
  score: number;
  suggestedAction?: string;
  pulsesAtRisk?: number;
  areaRank?: number;
  totalAreas?: number;
  gapFromOverall?: number;
  previousScore?: number;
}

function scoreTextColor() {
  return "text-amber-700";
}

export default function FocusArea({
  area,
  score,
  suggestedAction,
  pulsesAtRisk,
  areaRank,
  totalAreas,
  previousScore,
}: FocusAreaProps) {
  const hasPrevious = typeof previousScore === "number" && !Number.isNaN(previousScore);
  const trendDelta = hasPrevious ? Math.round((score - (previousScore as number)) * 10) / 10 : undefined;

  return (
    <div className="bg-amber-50/45 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-amber-100 border-l-4 border-l-amber-400 overflow-hidden">
      <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-amber-200">

        {/* Left: score */}
        <div className="w-48 shrink-0 px-5 py-5 flex flex-col justify-between gap-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            Focus This Pulse
          </p>

          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-1.5">
              <span className={`text-5xl font-bold leading-none tracking-tight ${scoreTextColor()}`}>
                {score.toFixed(1)}
              </span>
              <span className="text-lg font-medium text-slate-400 mb-0.5">/ 5</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {typeof areaRank === "number" && typeof totalAreas === "number" && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
                  Lowest of {totalAreas} areas
                </span>
              )}
              {pulsesAtRisk !== undefined && pulsesAtRisk >= 2 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600">
                  ⚠ {pulsesAtRisk} pulses
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: area + action */}
        <div className="flex-1 px-5 py-5 flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            Focus Area
          </p>
          <div className="flex flex-col gap-2">
            <p className="text-lg font-semibold text-slate-900">{area}</p>
            {hasPrevious && (
              <p className="text-xs text-slate-500">
                Last pulse: {(previousScore as number).toFixed(1)}
                <span className="mx-1 text-slate-300">→</span>
                {score.toFixed(1)}
                {typeof trendDelta === "number" && (
                  <span className={trendDelta > 0 ? "text-emerald-600" : trendDelta < 0 ? "text-rose-600" : "text-slate-500"}>
                    {trendDelta > 0 ? ` (+${trendDelta.toFixed(1)})` : trendDelta < 0 ? ` (${trendDelta.toFixed(1)})` : " (0.0)"}
                  </span>
                )}
              </p>
            )}
            <div className="rounded-md border border-amber-200/70 bg-amber-50/60 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700">Recommended Next Step</p>
              <p className="mt-1 text-sm text-slate-700">
                {suggestedAction || "Define one concrete action with owner and target date before the next pulse."}
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
