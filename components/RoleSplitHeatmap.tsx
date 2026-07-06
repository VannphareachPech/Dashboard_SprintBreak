"use client";
import type { RoleSplitRow } from "@/types/dashboard";

interface Props {
  rows: RoleSplitRow[];
}

// Pill color classes: bg + text + hover ring
function pillColor(score: number | undefined): string {
  if (score == null || isNaN(score)) return "bg-slate-50 text-slate-400 ring-slate-200";
  if (score >= 4.0) return "bg-emerald-50 text-emerald-700 ring-emerald-200 group-hover:bg-emerald-100 group-hover:ring-emerald-300";
  if (score >= 3.5) return "bg-sky-50 text-sky-700 ring-sky-200 group-hover:bg-sky-100 group-hover:ring-sky-300";
  if (score >= 3.0) return "bg-amber-50 text-amber-700 ring-amber-200 group-hover:bg-amber-100 group-hover:ring-amber-300";
  return "bg-rose-50 text-rose-700 ring-rose-300 group-hover:bg-rose-100 group-hover:ring-rose-400";
}

// Role gap column emphasis — escalating weight and color
function gapStyle(gap: number): string {
  if (gap >= 0.7) return "text-amber-700 font-bold";
  if (gap >= 0.6) return "text-amber-600 font-bold";
  if (gap >= 0.4) return "text-slate-600 font-bold";
  return "text-slate-500 font-bold";
}

export default function RoleSplitHeatmap({ rows }: Props) {
  if (!rows || rows.length === 0) return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5">
      <h3 className="text-lg font-semibold text-slate-700">Score by Role Group</h3>
      <p className="text-sm text-slate-400 mt-3">No role split data available yet.</p>
    </div>
  );

  const groups = Object.keys(rows[0].scores);

  function groupWidthClass(group: string): string {
    if (group === "Product Management" || group === "Product Development") return "w-44";
    if (group === "Shared") return "w-36";
    return "w-40";
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-slate-100 overflow-hidden">

      {/* Header + legend */}
      <div className="px-6 py-4 border-b border-slate-200/70 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
        <div>
          <h3 className="text-lg font-semibold text-slate-700">Score by Role Group</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            How scores differ across role groups — larger gaps signal uneven team experiences.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 shrink-0 sm:pt-1">
          {[
            { swatch: "bg-emerald-100", label: "Strong" },
            { swatch: "bg-sky-100",     label: "Stable" },
            { swatch: "bg-amber-100",   label: "Watch"  },
            { swatch: "bg-rose-100",    label: "At Risk" },
          ].map(({ swatch, label }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${swatch} inline-block`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-base">
          <colgroup>
            <col className="w-72" />
            {groups.map((g) => (
              <col key={`col-${g}`} className={groupWidthClass(g)} />
            ))}
            <col className="w-32" />
          </colgroup>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200/70">
              <th className="text-left px-6 py-3 text-sm font-semibold text-slate-600 w-72">
                Pulse Area
              </th>
              {groups.map((g) => (
                <th
                  key={g}
                  className={`px-4 py-3 text-sm font-semibold text-slate-600 text-center whitespace-nowrap ${groupWidthClass(g)}`}
                >
                  {g}
                </th>
              ))}
              <th className="px-4 py-3 text-sm font-semibold text-slate-700 text-center bg-slate-100/80 whitespace-nowrap w-32">
                Role Gap
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.area} className="group hover:bg-slate-50/40 transition-colors duration-100">
                <td className="px-6 py-3.5 text-slate-700 text-sm font-medium leading-snug">{row.area}</td>
                {groups.map((g) => {
                  const score = row.scores[g];
                  return (
                    <td
                      key={g}
                      className="px-4 py-3 text-center"
                    >
                      <span
                        className={`inline-flex items-center justify-center w-14 py-1.5 rounded-full text-sm font-semibold tabular-nums ring-1 transition-all duration-150 cursor-default select-none group-hover:ring-2 ${pillColor(score)}`}
                      >
                        {score !== undefined ? score.toFixed(1) : "—"}
                      </span>
                    </td>
                  );
                })}
                <td className={`px-4 py-3.5 text-center text-sm tabular-nums whitespace-nowrap bg-slate-50/60 ${gapStyle(row.roleGap)}`}>
                  {row.roleGap >= 0.7 && (
                    <span className="mr-1 text-amber-400 text-[10px]" aria-hidden="true">▲</span>
                  )}
                  {row.roleGap.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
