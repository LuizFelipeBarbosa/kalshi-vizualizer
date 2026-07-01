// Overview — the main page: global stats, color-coded category groups, and a server-side
// searchable + paginated index of every event. Ported from the vanilla views/overview.js.
// Filter state lives in the URL query (replace, not push, so history isn't spammed and the
// URL stays shareable); the client only ever holds one page of events.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useEvents, useSummary } from "../api/queries";
import type { EventsPage, EventsParams, EventSummary } from "../api/types";
import { ErrorNote, Loading } from "../components/Status";
import { fmtCompact, fmtInt, liftAccent } from "../lib/format";

const FALLBACK_ACCENT = "#9aa3b2";

const SORTS: [string, string][] = [
  ["volume", "volume"],
  ["recent", "most recent"],
  ["contracts", "# contracts"],
  ["ticker", "ticker"],
];

export default function OverviewView() {
  const summaryQuery = useSummary();
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: EventsParams = {
    group: searchParams.get("group") ?? "",
    q: searchParams.get("q") ?? "",
    sort: searchParams.get("sort") ?? "volume",
    page: Math.max(1, Number(searchParams.get("page")) || 1),
  };

  const eventsQuery = useEvents(filters);
  const rowsRef = useRef<HTMLDivElement>(null);

  // Functional setSearchParams: patches are applied on top of the LIVE URL state, never a
  // render-time snapshot — a pending search debounce can't revert a group/sort/page change
  // made during its 250ms window (the vanilla app got this via one shared mutable state).
  const update = useCallback(
    (patch: Partial<EventsParams>) => {
      setSearchParams(
        (prev) => {
          const next = {
            group: prev.get("group") ?? "",
            q: prev.get("q") ?? "",
            sort: prev.get("sort") ?? "volume",
            page: Math.max(1, Number(prev.get("page")) || 1),
            ...patch,
          };
          const params = new URLSearchParams();
          if (next.group) params.set("group", next.group);
          if (next.q) params.set("q", next.q);
          if (next.sort !== "volume") params.set("sort", next.sort);
          if (next.page > 1) params.set("page", String(next.page));
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const onSearch = useCallback((q: string) => update({ q, page: 1 }), [update]);

  function setPage(page: number) {
    update({ page });
    rowsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (summaryQuery.isPending) return <Loading />;
  if (summaryQuery.isError) return <ErrorNote error={summaryQuery.error} />;

  const summary = summaryQuery.data;
  const groupColor = summary.groups.find((g) => g.group === filters.group)?.color;
  const accent = groupColor ? liftAccent(groupColor) : FALLBACK_ACCENT;

  const toggleGroup = (group: string) => update({ group: filters.group === group ? "" : group, page: 1 });

  return (
    <>
      <p className="mb-4 text-2xs uppercase tracking-[0.12em] text-ink-1">Prediction archive</p>
      <div className="flex flex-wrap gap-12">
        <Stat value={fmtInt(summary.n_events)} label="Events" />
        <Stat value={fmtInt(summary.n_contracts)} label="Contracts" />
        <Stat value={fmtCompact(summary.total_volume)} label="Volume" />
        <Stat value={fmtCompact(summary.n_trades)} label="Trades" />
      </div>

      <div className="mt-12">
        <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-2">
          <p className="m-0 text-2xs uppercase tracking-[0.12em] text-ink-1">Category groups</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
          {summary.groups.map((g) => (
            <button
              key={g.group}
              type="button"
              onClick={() => toggleGroup(g.group)}
              className="cursor-pointer rounded-md border border-line border-l-[3px] bg-bg-1 px-4 py-3 text-left transition-all duration-[120ms] hover:-translate-y-px hover:border-l-[5px] hover:bg-bg-2"
              style={{ borderLeftColor: liftAccent(g.color) }}
            >
              <div className="text-base font-semibold">{g.group}</div>
              <div className="mt-2 font-mono text-sm text-ink-1">
                <span className="text-ink-0">{fmtCompact(g.total_volume)}</span> vol · {fmtInt(g.n_events)} events
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12">
        <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-2">
          <p className="m-0 text-2xs uppercase tracking-[0.12em] text-ink-1">Event index</p>
          <span className="flex-1" />
          <select
            value={filters.sort}
            onChange={(e) => update({ sort: e.target.value, page: 1 })}
            className="rounded-[3px] border border-line bg-bg-1 px-2 py-1 font-mono text-2xs text-ink-1"
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <SearchBox q={filters.q} accent={accent} loading={eventsQuery.isFetching} onSearch={onSearch} />

        <div className="flex flex-wrap gap-1">
          {["", ...summary.groups.map((g) => g.group)].map((g) => {
            const active = filters.group === g;
            return (
              <button
                key={g || "all"}
                type="button"
                onClick={() => update({ group: g, page: 1 })}
                className={`cursor-pointer rounded-[3px] border px-3 py-1 text-2xs tracking-[0.04em] ${
                  active ? "font-semibold text-bg-0" : "border-line text-ink-1 hover:text-ink-0"
                }`}
                style={active ? { background: accent, borderColor: accent } : undefined}
              >
                {g || "All"}
              </button>
            );
          })}
        </div>

        <div ref={rowsRef} className="mt-4 border-t border-line">
          <EventRows query={eventsQuery} />
        </div>

        {eventsQuery.data && <Pager page={filters.page} data={eventsQuery.data} onPage={setPage} />}
      </div>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-mega leading-none tracking-[-0.01em] tabular-nums">{value}</div>
      <div className="mt-2 text-2xs uppercase tracking-[0.12em] text-ink-1">{label}</div>
    </div>
  );
}

function SearchBox({
  q,
  accent,
  loading,
  onSearch,
}: {
  q: string;
  accent: string;
  loading: boolean;
  onSearch: (q: string) => void;
}) {
  const [input, setInput] = useState(q);
  const submitted = useRef(q);

  // Resync when q changes underneath us (wordmark link, back/forward). Comparing against
  // the last value THIS box submitted keeps the user's in-progress typing from being
  // stomped when their own debounced search lands.
  useEffect(() => {
    if (q !== submitted.current) {
      submitted.current = q;
      setInput(q);
    }
  }, [q]);

  // Debounce keystrokes into the URL (and thus the query) like the vanilla 250ms timer.
  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === q) return;
    const timer = setTimeout(() => {
      submitted.current = trimmed;
      onSearch(trimmed);
    }, 250);
    return () => clearTimeout(timer);
  }, [input, q, onSearch]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative block min-w-[220px] flex-1">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search events…"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-line bg-bg-1 px-3 py-2 font-mono text-sm text-ink-0 outline-none placeholder:text-ink-2 focus:border-ink-2"
        />
        <span
          className={`absolute bottom-0 left-0 h-[2px] transition-all ${loading ? "w-full opacity-100" : "w-0 opacity-0"}`}
          style={{ background: accent }}
        />
      </label>
    </div>
  );
}

function EventRows({ query }: { query: ReturnType<typeof useEvents> }) {
  if (query.isPending) return <Loading />;
  if (query.isError) return <div className="py-8 text-center font-mono text-ink-2">Couldn't load events.</div>;

  const events = query.data.events;
  if (events.length === 0) {
    return <div className="py-8 text-center font-mono text-ink-2">No events match.</div>;
  }

  return (
    <>
      {events.map((e) => (
        <EventRow key={e.event_ticker} event={e} />
      ))}
    </>
  );
}

function EventRow({ event: e }: { event: EventSummary }) {
  return (
    <Link
      to={`/event/${encodeURIComponent(e.event_ticker)}`}
      className="group flex cursor-pointer items-center gap-4 border-b border-l-[3px] border-line px-2 py-3 transition-colors hover:bg-bg-1"
      style={{ borderLeftColor: e.color ?? "transparent" }}
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: e.color ?? undefined }} />
        {e.sample_title || e.event_ticker}
      </span>
      <span className="w-[110px] shrink-0 text-2xs uppercase tracking-[0.06em] text-ink-1">{e.group || ""}</span>
      <span className="w-24 shrink-0 text-right font-mono text-sm text-ink-1 tabular-nums">
        {fmtInt(e.n_contracts)} mkts
      </span>
      <span className="w-24 shrink-0 text-right font-mono text-sm text-ink-0 tabular-nums">
        {fmtCompact(e.total_volume)}
      </span>
      <span className="w-4 text-right text-ink-2 transition-transform group-hover:translate-x-[2px] group-hover:text-ink-0">
        →
      </span>
    </Link>
  );
}

// `page` comes from the URL, not the response: under keepPreviousData the response still
// carries the previous page while the next one loads, which would make rapid clicks no-op.
function Pager({ page, data, onPage }: { page: number; data: EventsPage; onPage: (page: number) => void }) {
  const { total_pages, total } = data;
  const btn =
    "cursor-pointer rounded-[3px] border border-line bg-bg-1 px-3 py-2 font-mono text-sm text-ink-0 disabled:cursor-default disabled:text-ink-2 disabled:opacity-50";
  return (
    <div className="mt-6 flex items-center justify-center gap-4 font-mono text-sm text-ink-1">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ prev
      </button>
      <span>
        page {fmtInt(page)} / {fmtInt(total_pages)}
      </span>
      <span className="text-2xs text-ink-2">{fmtInt(total)} events</span>
      <button type="button" className={btn} disabled={page >= total_pages} onClick={() => onPage(page + 1)}>
        next ›
      </button>
    </div>
  );
}
