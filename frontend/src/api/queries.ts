// TanStack Query hooks — one per API endpoint. The dataset is a static build,
// so responses never go stale within a session.

import { useQuery } from "@tanstack/react-query";

import { ApiError, fetchContract, fetchEvent, fetchSummary } from "./client";

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

export function useEvent(eventTicker: string) {
  return useQuery({
    queryKey: ["event", eventTicker],
    queryFn: ({ signal }) => fetchEvent(eventTicker, signal),
    staleTime: Infinity,
    retry: noRetryOn404,
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
