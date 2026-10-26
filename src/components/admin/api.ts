"use client";

/**
 * Typed JSON client for /api/admin. Same-origin fetch; the session cookie is
 * sent automatically and the server re-checks everything.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; keepalive?: boolean } = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
    signal: init.signal,
    keepalive: init.keepalive,
    cache: "no-store",
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; code?: string; details?: Record<string, string> };
    if (res.status === 401 && typeof window !== "undefined") {
      // Session expired — keep work safe (local drafts) and send to login.
      window.dispatchEvent(new CustomEvent("studio:unauthorized"));
    }
    throw new ApiError(err.error ?? platformMessage(res.status), res.status, err.code, err.details);
  }
  return data as T;
}

/**
 * Responses that aren't the studio's JSON come from the host or the network
 * (Vercel's 413 for bodies over ~4.5 MB, a gateway timeout), so say what happened.
 */
function platformMessage(status: number): string {
  if (status === 413) return "That was too large to send in one request (the host accepts about 4.5 MB). Try a smaller file or batch.";
  if (status === 502 || status === 503 || status === 504) return `The server didn't respond in time (${status}). Try again in a moment.`;
  if (status === 404) return "The server couldn't find that (404). Reload the page and try again.";
  return `Request failed (${status}).`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.details ? Object.values(error.details)[0] : undefined;
    return detail && detail !== error.message ? `${error.message} ${detail}` : error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
