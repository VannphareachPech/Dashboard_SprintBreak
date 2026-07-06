import type { SummaryData } from "@/types/dashboard";

// Splits a sentence into React nodes, bolding any occurrence of areaNames.
function boldAreas(sentence: string, areaNames: string[]): React.ReactNode {
  if (!areaNames.length) return sentence;
  const escaped = areaNames.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "g");
  const parts = sentence.split(re);
  return parts.map((p, i) =>
    areaNames.includes(p) ? <strong key={i} className="font-semibold">{p}</strong> : p
  );
}

// Splits the narrative into sentences: the first is the headline, the rest become signal pills.
function NarrativePills({ text, areaNames }: { text: string; areaNames: string[] }) {
  if (!text) return null;

  const sentences = text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const [headline, ...signals] = sentences;

  // Detect whether a sentence is about strength (↑) or concern (↓)
  const isStrength = (s: string) =>
    /strongest|improv|best|highest|top performer/i.test(s);
  const isConcern = (s: string) =>
    /attention|risk|flagged|focus|lowest|concern/i.test(s);

  return (
    <div className="flex flex-col gap-2.5">
      {/* Headline sentence — larger, prominent */}
      {headline && (
        <p className="text-sm font-medium text-slate-700 leading-snug">
          {boldAreas(headline, areaNames)}
        </p>
      )}

      {/* Signal pills */}
      {signals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {signals.map((s, i) => {
            const strength = isStrength(s);
            const concern  = isConcern(s);
            return (
              <div
                key={i}
                className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs leading-snug ${
                  strength
                    ? "bg-emerald-50 text-emerald-800"
                    : concern
                    ? "bg-amber-50 text-amber-800"
                    : "bg-slate-50 text-slate-600"
                }`}
              >
                <span className="mt-px shrink-0 text-[10px] font-bold">
                  {strength ? "▲" : concern ? "▼" : "·"}
                </span>
                <span>{boldAreas(s, areaNames)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface HeroScoreProps {
  summary: SummaryData;
  prevCycle?: string;
  narrativeSummary?: string;
}

const statusConfig: Record<
  string,
  { bg: string; text: string; border: string; scoreColor: string; label: string }
> = {
  strong:    { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", scoreColor: "text-emerald-600", label: "Strong" },
  stable:    { bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-200",  scoreColor: "text-indigo-600",  label: "Stable" },
  watch:     { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   scoreColor: "text-amber-600",   label: "Watch" },
  "at risk": { bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200",    scoreColor: "text-rose-600",    label: "At Risk" },
};

export default function HeroScore({ summary, prevCycle, narrativeSummary }: HeroScoreProps) {
  const { overallScore, overallStatus, scoreDelta } = summary;
  const key = overallStatus.toLowerCase();
  const cfg = statusConfig[key] ?? statusConfig["stable"];
  const hasScore = overallScore > 0;

  const deltaUp   = scoreDelta !== undefined && scoreDelta > 0;
  const deltaDown = scoreDelta !== undefined && scoreDelta < 0;
  const deltaFlat = scoreDelta !== undefined && scoreDelta === 0;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 border-l-4 border-l-indigo-500 overflow-hidden">
      <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-slate-100">

        {/* Left: overall sentiment */}
        <div className="w-48 shrink-0 px-5 py-5 flex flex-col justify-between gap-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            Overall Sentiment
          </p>

          {/* Score + badge stacked */}
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-1.5">
              <span className={`text-5xl font-bold leading-none tracking-tight ${hasScore ? cfg.scoreColor : "text-slate-300"}`}>
                {hasScore ? overallScore.toFixed(1) : "—"}
              </span>
              <span className="text-lg font-medium text-slate-400 mb-0.5">/ 5</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                {cfg.label}
              </span>

              {scoreDelta !== undefined && (
                <span className="relative inline-flex items-center group">
                  <span className={`text-xs font-medium ${
                    deltaUp   ? "text-emerald-600" :
                    deltaDown ? "text-rose-600"    :
                                "text-slate-400"
                  }`}>
                    {deltaUp   && "↑ +"}
                    {deltaDown && "↓ "}
                    {deltaFlat && "→ "}
                    {Math.abs(scoreDelta).toFixed(1)}
                    {prevCycle && <span className="text-slate-400 font-normal"> vs {prevCycle}</span>}
                  </span>

                  <span className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                    {prevCycle ? `Compared to last pulse (${prevCycle})` : "Compared to last pulse"}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: leadership readout */}
        <div className="flex-1 px-5 py-5 flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            Leadership Readout
          </p>
          {narrativeSummary ? (
            <NarrativePills
              text={narrativeSummary}
              areaNames={[summary.highestArea, summary.lowestArea].filter(Boolean)}
            />
          ) : (
            <p className="text-sm text-slate-400 italic">No summary available yet.</p>
          )}
        </div>

      </div>
    </div>
  );
}
