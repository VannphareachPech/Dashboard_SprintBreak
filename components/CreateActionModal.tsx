"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionItem, ActionStatus } from "@/types/dashboard";

export const FOCUS_AREAS = [
  "Collaboration & Support",
  "Direction & Priorities",
  "Ownership & Empowerment",
  "Team Climate & Safety",
  "Value & Focus",
  "Ways of Working",
  "Workload & Sustainability",
] as const;

export type FocusArea = (typeof FOCUS_AREAS)[number];

const STATUS_OPTIONS: ActionStatus[] = ["Planned", "In Progress", "Completed"];

const statusDot: Record<ActionStatus, string> = {
  Planned:       "bg-slate-400",
  "In Progress": "bg-amber-400",
  Completed:     "bg-emerald-500",
};

interface CreateActionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (action: ActionItem) => void;
  currentCycle?: string;
  initialValues?: ActionItem;
}

const empty = {
  area: "" as FocusArea | "",
  suggestedAction: "",
  owner: "",
  status: "Planned" as ActionStatus,
  notes: "",
};

export default function CreateActionModal({
  open,
  onClose,
  onSubmit,
  currentCycle,
  initialValues,
}: CreateActionModalProps) {
  const [form, setForm] = useState({ ...empty });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof empty, string>>>({});
  const [focusOpen, setFocusOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const focusRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(initialValues ? {
        area: (initialValues.area as FocusArea | "") ?? "",
        suggestedAction: initialValues.suggestedAction,
        owner: initialValues.owner,
        status: initialValues.status,
        notes: initialValues.notes ?? "",
      } : { ...empty });
      setErrors({});
      setFocusOpen(false);
      setStatusOpen(false);
      setTimeout(() => firstFieldRef.current?.focus(), 50);
    }
  }, [open, initialValues]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (focusRef.current && !focusRef.current.contains(e.target as Node)) setFocusOpen(false);
    if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, handleClickOutside]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (focusOpen) { setFocusOpen(false); return; }
        if (statusOpen) { setStatusOpen(false); return; }
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, focusOpen, statusOpen, onClose]);

  if (!open) return null;

  const isEdit = !!initialValues;

  function validate() {
    const errs: typeof errors = {};
    if (!form.area) errs.area = "Focus area is required.";
    if (!form.suggestedAction.trim()) errs.suggestedAction = "Action is required.";
    if (!form.owner.trim()) errs.owner = "Owner is required.";
    return errs;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSubmit({
      suggestedAction: form.suggestedAction.trim(),
      owner: form.owner.trim(),
      status: form.status,
      area: form.area || undefined,
      notes: form.notes.trim() || undefined,
      pulseOpened: initialValues?.pulseOpened ?? currentCycle,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md mx-4 bg-white rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.14)] border border-slate-100">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-5">
          <div>
            <h2 className="text-base font-bold text-[#1E293B]">
              {isEdit ? "Edit Action" : "Create Action"}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {isEdit ? "Update this commitment" : "Log a follow-up commitment for this pulse cycle"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-0.5 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M11.5 3.5l-8 8M3.5 3.5l8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="border-t border-slate-100" />

        <form onSubmit={handleSubmit} noValidate>
          <div className="px-6 py-5 space-y-4">

            {/* Focus Area — custom dropdown */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                Focus Area <span className="text-rose-500 normal-case tracking-normal font-medium">*</span>
              </label>
              <div ref={focusRef} className="relative">
                <button
                  type="button"
                  onClick={() => { setFocusOpen((v) => !v); setStatusOpen(false); }}
                  className={[
                    "w-full appearance-none flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm text-left transition-colors",
                    "focus:outline-none",
                    errors.area
                      ? "border-rose-300 bg-rose-50/30"
                      : focusOpen
                      ? "border-indigo-400 ring-2 ring-indigo-400/25 bg-white"
                      : "border-slate-200 bg-white hover:border-slate-300",
                  ].join(" ")}
                >
                  <span className={form.area ? "text-[#1E293B] font-medium" : "text-slate-400"}>
                    {form.area || "Select focus area…"}
                  </span>
                  <svg
                    width="14" height="14" viewBox="0 0 14 14" fill="none"
                    className={`text-slate-400 flex-shrink-0 transition-transform duration-150 ${focusOpen ? "rotate-180" : ""}`}
                  >
                    <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {focusOpen && (
                  <div className="absolute z-20 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.10)] py-1.5 overflow-hidden">
                    {FOCUS_AREAS.map((fa) => (
                      <button
                        key={fa}
                        type="button"
                        onClick={() => {
                          setForm((f) => ({ ...f, area: fa }));
                          setErrors((er) => ({ ...er, area: undefined }));
                          setFocusOpen(false);
                        }}
                        className={[
                          "w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors",
                          form.area === fa
                            ? "bg-indigo-50 text-indigo-700 font-semibold"
                            : "text-[#475569] hover:bg-slate-50 hover:text-[#1E293B]",
                        ].join(" ")}
                      >
                        {fa}
                        {form.area === fa && (
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="flex-shrink-0">
                            <path d="M2.5 6.5l3 3 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {errors.area && <p className="mt-1.5 text-xs text-rose-500">{errors.area}</p>}
            </div>

            {/* Action */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                Action <span className="text-rose-500 normal-case tracking-normal font-medium">*</span>
              </label>
              <input
                ref={firstFieldRef}
                type="text"
                value={form.suggestedAction}
                onChange={(e) => {
                  setForm((f) => ({ ...f, suggestedAction: e.target.value }));
                  setErrors((er) => ({ ...er, suggestedAction: undefined }));
                }}
                placeholder="e.g. Run monthly team retro"
                maxLength={200}
                className={[
                  "w-full appearance-none rounded-xl border text-sm px-3.5 py-2.5 text-[#1E293B] placeholder-slate-400",
                  "focus:outline-none focus:ring-2 focus:ring-indigo-400/25 focus:border-indigo-400 transition-colors",
                  errors.suggestedAction ? "border-rose-300 bg-rose-50/30" : "border-slate-200 hover:border-slate-300",
                ].join(" ")}
              />
              {errors.suggestedAction && <p className="mt-1.5 text-xs text-rose-500">{errors.suggestedAction}</p>}
            </div>

            {/* Owner + Status */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Owner <span className="text-rose-500 normal-case tracking-normal font-medium">*</span>
                </label>
                <input
                  type="text"
                  value={form.owner}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, owner: e.target.value }));
                    setErrors((er) => ({ ...er, owner: undefined }));
                  }}
                  placeholder="Name or team"
                  maxLength={100}
                  className={[
                    "w-full appearance-none rounded-xl border text-sm px-3.5 py-2.5 text-[#1E293B] placeholder-slate-400",
                    "focus:outline-none focus:ring-2 focus:ring-indigo-400/25 focus:border-indigo-400 transition-colors",
                    errors.owner ? "border-rose-300 bg-rose-50/30" : "border-slate-200 hover:border-slate-300",
                  ].join(" ")}
                />
                {errors.owner && <p className="mt-1.5 text-xs text-rose-500">{errors.owner}</p>}
              </div>

              {/* Status — custom dropdown */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Status
                </label>
                <div ref={statusRef} className="relative">
                  <button
                    type="button"
                    onClick={() => { setStatusOpen((v) => !v); setFocusOpen(false); }}
                    className={[
                      "w-full appearance-none flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm transition-colors",
                      "focus:outline-none",
                      statusOpen
                        ? "border-indigo-400 ring-2 ring-indigo-400/25 bg-white"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-2 text-[#1E293B] font-medium">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[form.status]}`} />
                      {form.status}
                    </span>
                    <svg
                      width="14" height="14" viewBox="0 0 14 14" fill="none"
                      className={`text-slate-400 flex-shrink-0 transition-transform duration-150 ${statusOpen ? "rotate-180" : ""}`}
                    >
                      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {statusOpen && (
                    <div className="absolute z-20 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.10)] py-1.5 overflow-hidden">
                      {STATUS_OPTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => { setForm((f) => ({ ...f, status: s })); setStatusOpen(false); }}
                          className={[
                            "w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors",
                            form.status === s
                              ? "bg-indigo-50 text-indigo-700 font-semibold"
                              : "text-[#475569] hover:bg-slate-50 hover:text-[#1E293B]",
                          ].join(" ")}
                        >
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[s]}`} />
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                Notes <span className="text-slate-400 font-normal normal-case tracking-normal">(optional)</span>
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Context, blockers, or next steps…"
                rows={3}
                maxLength={500}
                className="w-full appearance-none rounded-xl border border-slate-200 hover:border-slate-300 text-sm px-3.5 py-2.5 text-[#1E293B] placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400/25 focus:border-indigo-400 transition-colors"
              />
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white transition-colors shadow-sm"
            >
              {isEdit ? "Save Changes" : "Save Action"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
