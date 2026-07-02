// Thin typed fetch wrappers over the JSON API. Caching, deduplication and
// abort handling belong to TanStack Query (see queries.ts), not this layer.

import type {
  ContractDetail,
  EventDetail,
  EventsPage,
  EventsParams,
  Highlight,
  HighlightsResponse,
  Summary,
} from "./types";

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

export function fetchEvents({ group, q, sort, page }: EventsParams, signal?: AbortSignal): Promise<EventsPage> {
  const params = new URLSearchParams();
  if (group) params.set("group", group);
  if (q) params.set("q", q);
  if (sort) params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  return getJSON(`/api/events?${params.toString()}`, signal);
}

export async function fetchHighlights(signal?: AbortSignal): Promise<Highlight[]> {
  const body = await getJSON<HighlightsResponse>("/api/highlights", signal);
  return body.highlights;
}

export function fetchEvent(eventTicker: string, signal?: AbortSignal): Promise<EventDetail> {
  return getJSON(`/api/event/${encodeURIComponent(eventTicker)}`, signal);
}

export function fetchContract(ticker: string, signal?: AbortSignal): Promise<ContractDetail> {
  return getJSON(`/api/contract/${encodeURIComponent(ticker)}`, signal);
}
