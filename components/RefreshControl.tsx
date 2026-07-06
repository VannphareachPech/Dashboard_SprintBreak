"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

export default function RefreshControl() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  // Track prev isPending so we update timestamp only when refresh finishes
  const wasPending = useRef(false);

  useEffect(() => {
    setLoadedAt(
      new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })
    );
  }, []);

  // When isPending flips from true → false, the refresh is done — update timestamp
  useEffect(() => {
    if (wasPending.current && !isPending) {
      setLoadedAt(
        new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })
      );
    }
    wasPending.current = isPending;
  }, [isPending]);

  function handleRefresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs leading-none">
      {isPending ? (
        <span className="text-indigo-500 font-medium animate-pulse">Refreshing…</span>
      ) : (
        <>
          <span className="text-slate-500">refreshed</span>
          <span className="font-semibold text-slate-800">{loadedAt ?? "—"}</span>
        </>
      )}
      <span className="group relative inline-flex">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          aria-label="Refresh dashboard data"
          className="rounded-full p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:opacity-40 transition-colors"
        >
          <RotateCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} aria-hidden />
        </button>
        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          Reload data from source
        </span>
      </span>
    </span>
  );
}
