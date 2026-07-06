"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Label,
} from "recharts";
import type { TrendPoint } from "@/types/dashboard";

interface TrendChartProps {
  trends: TrendPoint[];
  events?: Record<string, string>; // cycle label -> event name, e.g. { "Pulse 3": "Q2 kickoff" }
}

function dotColor(score: number): string {
  return score >= 3.5 ? "#5B5BD6" : "#ef4444";
}

type TooltipPayloadItem = {
  dataKey: string;
  value: number;
  color: string;
  name: string;
};

function CustomTooltip({
  active,
  payload,
  label,
  events,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  events: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const event = label ? events[label] : null;
  const score = payload[0]?.value as number;
  const color = dotColor(score);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg text-xs flex flex-col gap-1.5 min-w-[160px]">
      <div className="flex items-center justify-between gap-4">
        <p className="font-semibold text-slate-800">{label}</p>
        {event && <span className="text-[10px] text-slate-400 italic">{event}</span>}
      </div>
      <div className="border-t border-slate-100 pt-1 flex flex-col gap-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="text-slate-500">{p.name}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-semibold" style={{ color }}>{p.value.toFixed(1)}</span>
              {p.value < 3.5 && <span className="text-red-400 text-[10px]">&#9660;</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TrendChart({ trends, events = {} }: TrendChartProps) {
  if (!trends.length) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5 text-sm text-slate-500">
        No pulse history available yet.
      </div>
    );
  }

  // Latest delta: difference in overallScore between last two pulses
  const lastDelta = trends.length >= 2
    ? Number((trends[trends.length - 1].overallScore - trends[trends.length - 2].overallScore).toFixed(2))
    : null;
  const lastCycle = trends.length >= 2 ? trends[trends.length - 1].cycle : null;
  const prevCycle = trends.length >= 2 ? trends[trends.length - 2].cycle : null;

  return (
    <div className="h-full bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-slate-100 p-5 flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-700">Overall Sentiment Trend</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Team-wide average score across all pulse cycles.
          </p>
        </div>
        {lastDelta !== null && lastCycle && prevCycle && (
          <div className="flex flex-col items-end shrink-0">
            <span className={`text-sm font-semibold ${
              lastDelta > 0 ? "text-emerald-600" : lastDelta < 0 ? "text-rose-500" : "text-slate-400"
            }`}>
              {lastDelta > 0 ? `+${lastDelta}` : `${lastDelta}`}
            </span>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">
              {prevCycle} → {lastCycle}
            </span>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={trends} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
          {/* Stability zone band */}
          <ReferenceArea y1={3.5} y2={5} fill="#EEF2FF" fillOpacity={0.5} strokeOpacity={0} />

          <CartesianGrid stroke="#F3F4F6" vertical={false} />

          {/* Event markers — dashed vertical lines */}
          {Object.keys(events).map((cycle) => (
            <ReferenceLine
              key={cycle}
              x={cycle}
              stroke="#D1D5DB"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
          ))}

          {/* Target threshold line with label */}
          <ReferenceLine y={3.5} stroke="#9CA3AF" strokeDasharray="4 3" strokeWidth={1}>
            <Label value="target 3.5" position="insideBottomRight" fontSize={10} fill="#9CA3AF" offset={4} />
          </ReferenceLine>

          <XAxis
            dataKey="cycle"
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            dy={6}
          />
          <YAxis
            domain={[2.5, 5]}
            ticks={[3, 3.5, 4, 4.5, 5]}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            width={38}
          />

          <Tooltip
            content={(props) => (
              <CustomTooltip
                active={props.active}
                payload={(props.payload as unknown as TooltipPayloadItem[]) || []}
                label={props.label as string}
                events={events}
              />
            )}
            cursor={{ stroke: "#E5E7EB", strokeWidth: 1 }}
          />

          <Line
            type="monotone"
            dataKey="overallScore"
            name="Overall Sentiment"
            stroke="#5B5BD6"
            strokeWidth={2.5}
            dot={(props: Record<string, unknown>) => {
              const { cx, cy, payload } = props as { cx: number; cy: number; payload: TrendPoint };
              const fill = dotColor(payload.overallScore);
              return (
                <circle
                  key={payload.cycle}
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={fill}
                  stroke="#fff"
                  strokeWidth={2}
                />
              );
            }}
            activeDot={(props: unknown) => {
              const { cx, cy, payload } = props as { cx: number; cy: number; payload: TrendPoint };
              const fill = dotColor(payload.overallScore);
              return (
                <circle
                  key={`active-${payload.cycle}`}
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill={fill}
                  stroke="#fff"
                  strokeWidth={2}
                />
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>

      <p className="mt-3 text-xs text-slate-400">
        Dots in <span className="text-red-500 font-medium">red</span> indicate a score below the 3.5 target.
      </p>
    </div>
  );
}
