// TanStack Query hooks — one per API endpoint. The dataset is a static build,
// so responses never go stale within a session.

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { ApiError, fetchContract, fetchEvent, fetchEvents, fetchHighlights, fetchSummary } from "./client";
import type { EventsParams } from "./types";

// A 404 is a real answer ("no such ticker"), not a transient failure.
function noRetryOn404(failureCount: number, error: Error): boolean {
  return !(error instanceof ApiError && error.status === 404) && failureCount < 2;
}

export function useSummary() {
  return useQuery({
    queryKey: ["summary"],
    queryFn: ({ signal }) => fetchSummary(signal),
    staleTime: Infinity,
  });
}

export function useEvents(params: EventsParams) {
  return useQuery({
    queryKey: ["events", params.group, params.q, params.sort, params.page],
    queryFn: ({ signal }) => fetchEvents(params, signal),
    staleTime: Infinity,
    // Keep the previous page's rows on screen while the next one loads,
    // like the vanilla overview did (the search box shows the progress bar).
    placeholderData: keepPreviousData,
  });
}

export function useHighlights() {
  return useQuery({
    queryKey: ["highlights"],
    queryFn: ({ signal }) => fetchHighlights(signal),
    staleTime: Infinity,
  });
}

export function useEvent(eventTicker: string, enabled = true) {
  return useQuery({
    queryKey: ["event", eventTicker],
    queryFn: ({ signal }) => fetchEvent(eventTicker, signal),
    staleTime: Infinity,
    retry: noRetryOn404,
    enabled: enabled && eventTicker.length > 0,
  });
}

export function useContract(ticker: string) {
  return useQuery({
    queryKey: ["contract", ticker],
    queryFn: ({ signal }) => fetchContract(ticker, signal),
    staleTime: Infinity,
    retry: noRetryOn404,
  });
}
