"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import type { AreaScore } from "@/types/dashboard";

interface ScoreChartProps {
  areaScores: AreaScore[];
}

// Neutral graduated blue scale: deeper = stronger score.
// No semantic red/amber/green — board-friendly and emotionally neutral.
function barColor(score: number): string {
  if (score >= 4.0) return "#4338ca"; // indigo-700 — highest
  if (score >= 3.5) return "#6366f1"; // indigo-500
  if (score >= 3.0) return "#818cf8"; // indigo-400
  return "#a5b4fc";                   // indigo-300 — lowest
}

// Custom tooltip for hover display
function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: AreaScore }> }) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload as AreaScore;
    if (data.score == null) return null;
    return (
      <div className="bg-slate-900 text-white px-3 py-2 rounded-lg shadow-lg text-sm font-medium">
        <p className="font-semibold">{data.area}</p>
        <p className="text-indigo-200">Score: {data.score.toFixed(1)} / 5</p>
        {data.delta !== undefined && (
          <p className={`text-xs mt-1 ${data.delta > 0 ? "text-emerald-300" : data.delta < 0 ? "text-rose-300" : "text-slate-400"}`}>
            {data.delta > 0 ? "↑ +" : data.delta < 0 ? "↓ " : "→ "}
            {Math.abs(data.delta).toFixed(1)} from last pulse
          </p>
        )}
      </div>
    );
  }
  return null;
}

export default function ScoreChart({ areaScores }: ScoreChartProps) {
  const data = [...areaScores];

  if (data.length === 0) return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5">
      <h2 className="text-lg font-semibold text-slate-700">Pulse Area Scores</h2>
      <p className="text-sm text-slate-400 mt-3">No area score data available yet.</p>
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5">
      <h2 className="text-lg font-semibold text-slate-700 mb-1">
        Pulse Area Scores
      </h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3">
        How each engagement area is scoring this cycle, out of 5.
      </p>

      <ResponsiveContainer width="100%" height={340}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 40, left: 24, bottom: 4 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="0" stroke="#e2e8f0" strokeOpacity={0.6} horizontal={false} vertical={true} />
          <XAxis
            type="number"
            domain={[0, 5]}
            ticks={[1, 2, 3, 4, 5]}
            tick={{ fontSize: 12, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="area"
            width={190}
            tick={(props) => (
              (() => {
                const x = typeof props.x === "number" ? props.x : 0;
                const y = typeof props.y === "number" ? props.y : 0;
                const label = props?.payload && typeof props.payload.value === "string"
                  ? props.payload.value
                  : "";
                return (
                  <text
                    x={x - 10}
                    y={y}
                    dy={4}
                    textAnchor="end"
                    fontSize={14}
                    fill="#334155"
                    fontWeight={500}
                  >
                    {label}
                  </text>
                );
              })()
            )}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(99, 102, 241, 0.05)" }} />
          <Bar dataKey="score" radius={[0, 3, 3, 0]}>
            <LabelList
              dataKey="score"
              position="right"
              formatter={(v: unknown) => (typeof v === "number" ? v.toFixed(1) : String(v ?? ""))}
              style={{ fontSize: 12, fill: "#475569", fontWeight: 500 }}
            />
            {data.map((entry) => (
              <Cell key={entry.area} fill={barColor(entry.score)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
