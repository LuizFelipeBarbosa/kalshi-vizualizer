// Thin typed fetch wrappers over the JSON API. Caching, deduplication and
// abort handling belong to TanStack Query (see queries.ts), not this layer.

import type { ContractDetail, EventDetail, Summary } from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body; keep the status line.
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export function fetchSummary(signal?: AbortSignal): Promise<Summary> {
  return getJSON("/api/summary", signal);
}

export function fetchEvent(eventTicker: string, signal?: AbortSignal): Promise<EventDetail> {
  return getJSON(`/api/event/${encodeURIComponent(eventTicker)}`, signal);
}

export function fetchContract(ticker: string, signal?: AbortSignal): Promise<ContractDetail> {
  return getJSON(`/api/contract/${encodeURIComponent(ticker)}`, signal);
}
