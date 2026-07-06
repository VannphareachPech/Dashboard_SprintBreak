"use client";
import type { ResponseCountPoint } from "@/types/dashboard";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: ResponseCountPoint[];
  teamSize?: number;
}

function getPulseNumber(label: string): number | null {
  const m = String(label).match(/pulse\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

export default function ResponseCountChart({ data, teamSize }: Props) {
  if (!data || data.length === 0) return (
    <div className="h-full bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5">
      <h3 className="text-lg font-semibold text-slate-700">Participation by Pulse</h3>
      <p className="text-sm text-slate-400 mt-3">No participation data available yet.</p>
    </div>
  );

  // Keep timeline left-to-right (Pulse 1 -> Pulse 2) when pulse numbers exist.
  const chartData = [...data].sort((a, b) => {
    const aPulse = getPulseNumber(a.cycle);
    const bPulse = getPulseNumber(b.cycle);
    if (aPulse !== null && bPulse !== null) return aPulse - bPulse;
    return String(a.cycle).localeCompare(String(b.cycle));
  });

  // Pre-compute delta % for each bar vs previous
  const withDelta = chartData.map((point, i) => {
    const prev = i > 0 ? chartData[i - 1].responseCount : null;
    const curr = point.responseCount;
    let delta: number | null = null;
    if (prev !== null && prev !== undefined && prev > 0 && curr !== undefined) {
      delta = Math.round(((curr - prev) / prev) * 100);
    }
    return { ...point, delta };
  });

  // Latest delta badge (last pulse vs second-to-last)
  const lastDelta = withDelta.length >= 2 ? withDelta[withDelta.length - 1].delta : null;
  const lastCycle = chartData.length >= 2 ? chartData[chartData.length - 1].cycle : null;
  const prevCycle = chartData.length >= 2 ? chartData[chartData.length - 2].cycle : null;

  return (
    <div className="h-full bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5 flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-700">Participation by Pulse</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Number of responses received per pulse cycle.
          </p>
        </div>
        {lastDelta !== null && lastCycle && prevCycle && (
          <div className={`flex flex-col items-end shrink-0`}>
            <span className={`text-sm font-semibold ${
              lastDelta > 0 ? "text-emerald-600" : lastDelta < 0 ? "text-rose-500" : "text-slate-400"
            }`}>
              {lastDelta > 0 ? `+${lastDelta}%` : `${lastDelta}%`}
            </span>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">
              {prevCycle} → {lastCycle}
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-[260px]">
        <ResponsiveContainer width="100%" height={300}>
        <BarChart data={withDelta} margin={{ top: 20, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="cycle"
            interval={0}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, teamSize && teamSize > 0 ? teamSize : "auto"]}
            tickCount={6}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "#f8fafc" }}
            contentStyle={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => {
              const n = typeof value === "number" ? value : Number(value || 0);
              return [`${n} responses`, "Count"];
            }}
          />
          <Bar
            dataKey="responseCount"
            fill="#818cf8"
            radius={[6, 6, 0, 0]}
            maxBarSize={56}
            minPointSize={6}
          >
            <LabelList
              dataKey="responseCount"
              position="top"
              style={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }}
            />
          </Bar>
        </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
