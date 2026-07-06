"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TrendPoint } from "@/types/dashboard";

const SERIES = [
  { key: "Collaboration & Support",    label: "Collaboration & Support",    color: "#7C3AED" },
  { key: "Direction & Priorities",     label: "Direction & Priorities",     color: "#2563EB" },
  { key: "Ownership & Empowerment",    label: "Ownership & Empowerment",    color: "#16A34A" },
  { key: "Team Climate & Safety",      label: "Team Climate & Safety",      color: "#DB2777" },
  { key: "Value & Focus",              label: "Value & Focus",              color: "#D97706" },
  { key: "Ways of Working",            label: "Ways of Working",            color: "#DC2626" },
  { key: "Workload & Sustainability",  label: "Workload & Sustainability",  color: "#6B7280" },
];

type ChartRow = { pulse: string; [key: string]: string | number };

function getPulseNumber(label: string): number | null {
  const m = String(label).match(/pulse\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function getNumericValue(point: TrendPoint, area: string): number | undefined {
  const direct = Number(point[area]);
  if (!Number.isNaN(direct) && direct > 0) return Math.round(direct * 10) / 10;
  const suffix = Number(point[area + " Score"]);
  if (!Number.isNaN(suffix) && suffix > 0) return Math.round(suffix * 10) / 10;
  return undefined;
}

type TooltipPayloadItem = { dataKey: string; value: number; color: string; name: string };

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg text-xs min-w-[200px]">
      <p className="font-semibold text-slate-800 mb-2">{label}</p>
      <div className="flex flex-col gap-1">
        {sorted.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="text-slate-500">{p.name}</span>
            </div>
            <span className="font-semibold tabular-nums" style={{ color: p.value < 3.5 ? "#EF4444" : p.color }}>
              {p.value.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type DotProps = { cx?: number; cy?: number; payload?: Record<string, number | string>; dataKey?: string; color?: string };

function CustomDot({ cx, cy, payload, dataKey, color }: DotProps) {
  if (!cx || !cy || !payload || !dataKey) return null;
  const val = payload[dataKey] as number;
  const fill = val < 3.5 ? "#EF4444" : color;
  return <circle cx={cx} cy={cy} r={4} fill={fill} stroke="#fff" strokeWidth={2} />;
}

function ActiveDot({ cx, cy, payload, dataKey, color }: DotProps) {
  if (!cx || !cy || !payload || !dataKey) return null;
  const val = payload[dataKey] as number;
  const fill = val < 3.5 ? "#EF4444" : color;
  return <circle cx={cx} cy={cy} r={5} fill={fill} stroke="#fff" strokeWidth={2} />;
}

interface Props {
  trends: TrendPoint[];
}

export default function PulseQuestionTrendChart({ trends }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (!trends || trends.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5">
        <h3 className="text-lg font-semibold text-slate-700">Pulse Area Performance Over Time</h3>
        <p className="text-sm text-slate-400 mt-3">No trend data available yet.</p>
      </div>
    );
  }

  const chartData: ChartRow[] = [...trends]
    .filter((t) => String(t.cycle || "").trim().length > 0)
    .sort((a, b) => {
      const an = getPulseNumber(a.cycle);
      const bn = getPulseNumber(b.cycle);
      if (an !== null && bn !== null) return an - bn;
      return String(a.cycle).localeCompare(String(b.cycle));
    })
    .map((point) => {
      const row: ChartRow = { pulse: String(point.cycle) };
      SERIES.forEach(({ key }) => {
        const val = getNumericValue(point, key);
        if (val !== undefined) row[key] = val;
      });
      return row;
    });

  const hasData = chartData.some((row) => SERIES.some(({ key }) => typeof row[key] === "number"));
  if (!hasData) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5">
        <h3 className="text-lg font-semibold text-slate-700">Pulse Area Performance Over Time</h3>
        <p className="text-sm text-slate-400 mt-3">No trend data available yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-700">Pulse Area Performance Over Time</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          How each engagement area has trended across cycles — scores below 3.5 flagged in red.
        </p>
      </div>

      {/* Series toggles */}
      <div className="flex flex-wrap gap-2">
        {SERIES.map((s) => {
          const isActive = hovered === null || hovered === s.key;
          return (
            <button
              key={s.key}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setHovered(hovered === s.key ? null : s.key)}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-opacity cursor-pointer"
              style={{
                borderColor: isActive ? s.color : "#E5E7EB",
                color: isActive ? s.color : "#9CA3AF",
                opacity: isActive ? 1 : 0.4,
              }}
            >
              <span className="inline-block size-2 rounded-full shrink-0" style={{ background: isActive ? s.color : "#D1D5DB" }} />
              {s.label}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="#F3F4F6" vertical={false} />
          <ReferenceLine y={3.5} stroke="#9CA3AF" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: "target 3.5", position: "insideBottomRight", fontSize: 10, fill: "#9CA3AF", offset: 4 }}
          />
          <XAxis dataKey="pulse" tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} dy={6} />
          <YAxis
            domain={[1, 5]}
            ticks={[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]}
            tick={{ fontSize: 11, fill: "#9CA3AF" }}
            axisLine={false}
            tickLine={false}
            width={34}
          />
          <Tooltip content={(props) => <CustomTooltip active={props.active} payload={props.payload as unknown as TooltipPayloadItem[]} label={props.label as string} />} cursor={{ stroke: "#E5E7EB", strokeWidth: 1 }} />

          {SERIES.map((s) => {
            const dimmed = hovered !== null && hovered !== s.key;
            return (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={dimmed ? 1 : 2}
                strokeOpacity={dimmed ? 0.15 : 1}
                dot={(props: Record<string, unknown>) => (
                  <CustomDot
                    key={`${s.key}-${String(props.cx)}-${String(props.cy)}`}
                    cx={props.cx as number}
                    cy={props.cy as number}
                    payload={props.payload as Record<string, number | string>}
                    dataKey={s.key}
                    color={s.color}
                  />
                )}
                activeDot={(props: unknown) => {
                  const p = props as { cx?: number; cy?: number; payload?: Record<string, number | string> };
                  return (
                    <ActiveDot
                      key={`active-${s.key}`}
                      cx={p.cx as number}
                      cy={p.cy as number}
                      payload={p.payload as Record<string, number | string>}
                      dataKey={s.key}
                      color={s.color}
                    />
                  );
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      <p className="text-xs text-slate-400 -mt-2">
        Dots in <span className="text-red-400 font-medium">red</span> indicate a score below the 3.5 target. Hover a label above to isolate a series.
      </p>
    </div>
  );
}
