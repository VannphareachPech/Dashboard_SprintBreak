"use client";

import { useEffect, useRef, useState } from "react";
import { Edit2, Pin, Trash2 } from "lucide-react";
import type { ActionItem, ActionStatus } from "@/types/dashboard";
import CreateActionModal from "./CreateActionModal";

// Single cache key — full canonical list, hydrated from server on mount.
// Bump the version suffix when the ActionItem shape changes so stale data
// is silently discarded on next load.
const LS_KEY = "b2css_actions_cache_v1";

function actionKey(a: ActionItem) {
  return `${a.suggestedAction}||${a.owner}||${a.area ?? ""}`;
}

interface ActionTrackerProps {
  actions: ActionItem[];
  currentCycle?: string;
}

const statusDot: Record<ActionStatus, string> = {
  Planned:       "bg-slate-400",
  "In Progress": "bg-amber-400",
  Completed:     "bg-emerald-500",
};

export default function ActionTracker({ actions, currentCycle }: ActionTrackerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAction, setEditingAction] = useState<ActionItem | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [modalViewText, setModalViewText] = useState<{
    title: string;
    action: string;
    note: string;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    action: ActionItem;
    idx: number;
  } | null>(null);
  const [newActionId, setNewActionId] = useState<string | null>(null);
  const [justPinnedId, setJustPinnedId] = useState<string | null>(null);
  const rowsContainerRef = useRef<HTMLTableSectionElement>(null);

  // ── Single canonical list — always start from server props to match SSR ──────
  // localStorage hydration is deferred to useEffect so server/client render match.
  const [allActions, setAllActions] = useState<ActionItem[]>(() => {
    if (actions.length > 0) return actions;
    if (typeof window === "undefined") return actions;
    try {
      const stored = localStorage.getItem(LS_KEY);
      const cached = stored ? (JSON.parse(stored) as ActionItem[]) : [];
      return cached.length > 0 ? cached : actions;
    } catch {
      return actions;
    }
  });

  // Persist canonical list to localStorage as fast-paint cache.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(allActions)); } catch { /* silent */ }
  }, [allActions]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 2200);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  // On mount: refresh from server so cross-user changes surface immediately.
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const res = await fetch("/api/actions", { cache: "no-store" });
        const data = await res.json() as { ok?: boolean; actions?: ActionItem[] };
        if (canceled || !data.ok || !Array.isArray(data.actions)) return;
        if (data.actions.length > 0) setAllActions(data.actions);
      } catch { /* best-effort; cached state remains */ }
    })();
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    if (!modalViewText) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalViewText(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalViewText]);

  useEffect(() => {
    if (!newActionId || !rowsContainerRef.current) return;
    requestAnimationFrame(() => {
      const element = rowsContainerRef.current?.querySelector(`[data-action-id="${newActionId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        element.classList.add("animate-pulse");
        const timer = setTimeout(() => {
          element.classList.remove("animate-pulse");
          setNewActionId(null);
        }, 2000);
        return () => clearTimeout(timer);
      } else {
        setNewActionId(null);
      }
    });
  }, [newActionId]);

  // ── Single canonical row list — sorted pinned-first ────────────────────────
  const allRows = allActions.map((a, idx) => ({
    id: `r-${idx}-${actionKey(a)}`,
    action: a,
    idx,
  })).sort((a, b) => Number(b.action.isPinned) - Number(a.action.isPinned));

  const successBanner = toastMessage ? (
    <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-700">
      {toastMessage}
    </div>
  ) : null;

  function syncToServer(method: "POST" | "PUT" | "DELETE", body: Partial<ActionItem>) {
    fetch("/api/actions", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => res.json())
      .then(() => {
        // After PUT/DELETE, re-fetch to ensure state is in sync with sheet
        if (method === "PUT" || method === "DELETE") {
          return fetch("/api/actions", { cache: "no-store" })
            .then((r) => r.json() as Promise<{ ok?: boolean; actions?: ActionItem[] }>)
            .then((data) => {
              if (data.ok && Array.isArray(data.actions)) {
                setAllActions(data.actions);
              }
            });
        }
      })
      .catch(() => { /* optimistic state already applied */ });
  }

  function handleCreate(action: ActionItem) {
    const isUpdate = editingIdx !== null;
    const normalizedAction: ActionItem = {
      ...action,
      isPinned: action.isPinned ?? editingAction?.isPinned ?? false,
      id: action.id ?? editingAction?.id,  // preserve stable id through edits
    };

    if (isUpdate && editingIdx !== null) {
      setAllActions((prev) => prev.map((a, i) => i === editingIdx ? normalizedAction : a));
      syncToServer("PUT", {
        ...normalizedAction,
        originalSuggestedAction: editingAction?.suggestedAction,
        originalOwner: editingAction?.owner,
        originalArea: editingAction?.area,
      } as Partial<ActionItem>);
    } else {
      setAllActions((prev) => [normalizedAction, ...prev]);
      setNewActionId(`r-0-${actionKey(normalizedAction)}`);
      syncToServer("POST", normalizedAction);
    }

    setEditingAction(null);
    setEditingIdx(null);
    setToastMessage(isUpdate ? "Action updated." : "Action created.");
  }

  function handleEdit(action: ActionItem, idx: number) {
    setEditingAction(action);
    setEditingIdx(idx);
    setModalOpen(true);
  }

  function requestDelete(action: ActionItem, idx: number) {
    setConfirmDelete({ action, idx });
  }

  function confirmDeleteAction() {
    if (!confirmDelete) return;
    const { action, idx } = confirmDelete;
    setAllActions((prev) => prev.filter((_, i) => i !== idx));
    setConfirmDelete(null);
    setToastMessage("Action deleted.");
    syncToServer("DELETE", action);
  }

  function handleModalClose() {
    setModalOpen(false);
    setEditingAction(null);
    setEditingIdx(null);
  }

  function handlePinClick(rowId: string, action: ActionItem, idx: number) {
    const updated = { ...action, isPinned: !action.isPinned };
    setAllActions((prev) => prev.map((a, i) => i === idx ? updated : a));
    setJustPinnedId(rowId);
    setToastMessage(updated.isPinned ? "Action pinned." : "Action unpinned.");
    setTimeout(() => setJustPinnedId(null), 650);
    syncToServer("PUT", updated);
  }

  const createActionButton = (
    <button
      type="button"
      onClick={() => setModalOpen(true)}
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800 transition-colors whitespace-nowrap"
    >
      Create Action
      <svg className="h-4 w-4" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M2 6h8M6.5 2.5L10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );

  if (!allRows.length) {
    return (
      <>
        {successBanner}
        <div className="rounded-xl border border-slate-100 bg-white py-3 px-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">No leadership actions tracked yet.</p>
          {createActionButton}
        </div>
        <CreateActionModal
          open={modalOpen}
          onClose={handleModalClose}
          onSubmit={handleCreate}
          currentCycle={currentCycle}
          initialValues={editingAction ?? undefined}
        />
      </>
    );
  }

  return (
    <>
      {successBanner}
      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200/70 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
          <div>
            <h3 className="text-lg font-semibold text-slate-700">Leadership Action Items</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Commitments raised from pulse insights, tracked to completion.
            </p>
          </div>
          {createActionButton}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/70">
                <th className="w-[40px] px-2 py-3" aria-label="Pin" />
                <th className="w-[220px] px-2 py-3 text-left text-sm font-semibold text-slate-600">Focus Area</th>
                <th className="w-[220px] px-2 py-3 text-left text-sm font-semibold text-slate-600">Action</th>
                <th className="w-[190px] px-2 py-3 text-left text-sm font-semibold text-slate-600">Owner</th>
                <th className="w-[140px] px-2 py-3 text-left text-sm font-semibold text-slate-600">Status</th>
                <th className="w-[190px] px-2 py-3 text-left text-sm font-semibold text-slate-600">Note</th>
                <th className="w-[100px] px-2 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody ref={rowsContainerRef} className="divide-y divide-slate-100">
              {allRows.map((row) => {
                const a = row.action;
                return (
                  <tr key={row.id} data-action-id={row.id} className={`group hover:bg-slate-50/40 transition-colors duration-100 ${justPinnedId === row.id ? "animate-pin-flash" : ""}`}>
                    <td className="w-[40px] px-2 py-2 align-middle text-center">
                      <button
                        type="button"
                        title={a.isPinned ? "Unpin record" : "Pin record"}
                          onClick={() => handlePinClick(row.id, a, row.idx)}
                        className={[
                          "rounded p-1 transition-colors focus-visible:outline-none",
                          a.isPinned
                            ? "text-amber-400 hover:text-amber-500"
                            : "text-slate-300 hover:bg-slate-200 hover:text-slate-600",
                        ].join(" ")}
                        aria-pressed={a.isPinned ? "true" : "false"}
                        aria-label={a.isPinned ? "Unpin action record" : "Pin action record"}
                      >
                        <Pin className={`h-4 w-4 ${a.isPinned ? "fill-amber-400 stroke-amber-500" : ""}`} aria-hidden />
                      </button>
                    </td>
                    <td className="w-[220px] px-2 py-2 text-left align-middle">
                      <span className="text-sm font-medium text-slate-900 whitespace-nowrap">{a.area ?? "—"}</span>
                    </td>
                    <td className="w-[220px] px-2 py-2 text-left align-middle text-sm text-slate-700 max-w-0">
                      <button
                        type="button"
                        onClick={() =>
                          setModalViewText({
                            title: "Action & Note Detail",
                            action: a.suggestedAction || "No action detail provided.",
                            note: a.notes || "—",
                          })
                        }
                        className="group block w-full truncate text-left text-sm text-indigo-600 cursor-pointer hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/50 rounded-sm transition-colors"
                        title={a.suggestedAction}
                      >
                        <span className="underline-offset-2 group-hover:underline">{a.suggestedAction}</span>
                      </button>
                    </td>
                    <td className="w-[190px] px-2 py-2 align-middle text-sm text-slate-700 max-w-0">
                      <span className="block truncate" title={a.owner}>{a.owner}</span>
                    </td>
                    <td className="w-[140px] px-2 py-2 text-left align-middle">
                      <span className="inline-flex items-center gap-2 text-sm text-slate-700 whitespace-nowrap">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[a.status]}`} />
                        {a.status}
                      </span>
                    </td>
                    <td className="w-[190px] px-2 text-left py-2 align-middle max-w-0">
                      {a.notes ? (
                        <button
                          type="button"
                          onClick={() =>
                            setModalViewText({
                              title: "Action & Note Detail",
                              action: a.suggestedAction || "No action detail provided.",
                              note: a.notes || "—",
                            })
                          }
                          className="group block w-full truncate text-left text-xs text-slate-500 cursor-pointer hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/50 rounded-sm leading-5 transition-colors"
                          title={a.notes}
                        >
                          <span className="underline-offset-2 group-hover:underline">{a.notes}</span>
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => handleEdit(a, row.idx)}
                          className="rounded p-2 hover:bg-slate-200 transition-colors"
                        >
                          <Edit2 className="h-4 w-4 text-slate-600" aria-hidden />
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => requestDelete(a, row.idx)}
                          className="rounded p-2 hover:bg-red-100 transition-colors"
                        >
                          <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <CreateActionModal
        open={modalOpen}
        onClose={handleModalClose}
        onSubmit={handleCreate}
        currentCycle={currentCycle}
        initialValues={editingAction ?? undefined}
      />

      {/* Action/Note inspection modal */}
      {modalViewText && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-[2px] px-4"
          role="dialog"
          aria-modal="true"
          aria-label={modalViewText.title}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalViewText(null);
          }}
        >
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-[0_20px_60px_rgba(15,23,42,0.28)] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <h3 className="text-base sm:text-lg font-semibold text-slate-900">{modalViewText.title}</h3>
              <button
                type="button"
                aria-label="Close detail view"
                onClick={() => setModalViewText(null)}
                className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <span className="text-xl leading-none">×</span>
              </button>
            </div>

            <div className="px-6 py-5">
              <div className="max-h-[60vh] overflow-y-auto bg-slate-50 rounded-xl p-5 border border-slate-100/80 whitespace-pre-wrap">
                <div className="border-b border-slate-200/60 pb-3 mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Action:</span>
                  <p className="text-base font-semibold text-slate-800">{modalViewText.action}</p>
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Note:</span>
                  <p className="text-sm text-slate-600 leading-relaxed">{modalViewText.note}</p>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 flex justify-end">
              <button
                type="button"
                onClick={() => setModalViewText(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-sm"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
        >
          <div className="w-full max-w-sm mx-4 bg-white rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.14)] border border-slate-100">
            {/* Header */}
            <div className="px-6 pt-6 pb-4">
              <h2 className="text-base font-bold text-[#1E293B]">Delete Action?</h2>
            </div>
            {/* Divider */}
            <div className="border-t border-slate-100" />
            {/* Body */}
            <div className="px-6 py-5">
              <p className="text-sm leading-relaxed text-[#475569]">
                Are you sure you want to delete{" "}
                <span className="font-semibold text-[#1E293B]">
                  &ldquo;{confirmDelete.action.suggestedAction}&rdquo;
                </span>
                ? This action cannot be undone.
              </p>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 pb-6">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteAction}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white transition-colors shadow-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
