import { NextRequest, NextResponse } from "next/server";
import type { ActionItem } from "@/types/dashboard";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// Same-origin check for write endpoints. Blocks POST/PUT/DELETE from external
// origins (curl, other sites, etc.). Sized for a small internal tool — not a
// substitute for real auth, but stops random internet writes.
function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (!host) return false;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  // Some browsers omit Origin on same-origin requests; fall back to Referer.
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  // No Origin and no Referer — reject writes to be safe.
  return false;
}

// Whitelist of fields the client is allowed to send — prevents field injection.
const ALLOWED_ACTION_FIELDS = new Set([
  "area", "suggestedAction", "owner", "status", "notes", "isPinned",
  "pulseOpened", "id", "originalSuggestedAction", "originalOwner", "originalArea",
]);

// Allowed status values — "Deleted" is a server-only sentinel and MUST NOT
// be settable via the update endpoint (delete endpoint owns it).
const ALLOWED_STATUS_VALUES = new Set(["Planned", "In Progress", "Completed"]);

// Per-field length caps to prevent sheet cell overflow and prompt bloat.
const FIELD_MAX_LEN: Record<string, number> = {
  area: 120,
  suggestedAction: 1000,
  owner: 120,
  status: 32,
  notes: 2000,
  pulseOpened: 32,
  id: 64,
  originalSuggestedAction: 1000,
  originalOwner: 120,
  originalArea: 120,
};

function sanitizeBody(raw: Record<string, unknown>, opts: { allowDeletedStatus?: boolean } = {}): {
  ok: true; data: Record<string, unknown>;
} | { ok: false; error: string } {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_ACTION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];

    if (key === "isPinned") {
      if (typeof value !== "boolean" && value !== undefined) {
        return { ok: false, error: `Field '${key}' must be a boolean.` };
      }
      out[key] = value;
      continue;
    }

    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      return { ok: false, error: `Field '${key}' must be a string.` };
    }

    const trimmed = value.trim();
    const cap = FIELD_MAX_LEN[key] ?? 500;
    if (trimmed.length > cap) {
      return { ok: false, error: `Field '${key}' exceeds max length of ${cap}.` };
    }

    if (key === "status") {
      if (!ALLOWED_STATUS_VALUES.has(trimmed) && !(opts.allowDeletedStatus && trimmed === "Deleted")) {
        return { ok: false, error: `Invalid status value.` };
      }
    }

    out[key] = trimmed;
  }
  return { ok: true, data: out };
}

async function proxyPost(body: Record<string, unknown>) {
  if (!APPS_SCRIPT_URL) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  // Attach shared-secret token so the Apps Script auth check passes.
  const token = process.env.APPS_SCRIPT_TOKEN;
  const bodyWithToken = token ? { ...body, token } : body;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(bodyWithToken),
    });
    const data = await res.json() as Record<string, unknown>;
    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET /api/actions — fetch latest actions list from the sheet
export async function GET() {
  if (!APPS_SCRIPT_URL) return NextResponse.json({ ok: false, actions: [] });
  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set("action", "getActions");
    const token = process.env.APPS_SCRIPT_TOKEN;
    if (token) url.searchParams.set("token", token);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false, actions: [] });
    const data = await res.json() as { ok?: boolean; actions?: ActionItem[] };
    return NextResponse.json({ ok: true, actions: data.actions ?? [] });
  } catch {
    return NextResponse.json({ ok: false, actions: [] });
  }
}

// POST /api/actions — create a new action in the sheet
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let raw: Record<string, unknown>;
  try {
    raw = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = sanitizeBody(raw);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return proxyPost({ action: "saveAction", ...result.data });
}

// PUT /api/actions — update status/notes on an existing action
export async function PUT(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let raw: Record<string, unknown>;
  try {
    raw = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // Update path must never accept "Deleted" — that's a soft-delete sentinel
  // owned by the DELETE endpoint.
  const result = sanitizeBody(raw, { allowDeletedStatus: false });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return proxyPost({ action: "updateAction", ...result.data });
}

// DELETE /api/actions — soft-delete an action (sets status = "Deleted" in sheet)
export async function DELETE(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let raw: Record<string, unknown>;
  try {
    raw = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = sanitizeBody(raw, { allowDeletedStatus: true });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return proxyPost({ action: "deleteAction", ...result.data });
}
