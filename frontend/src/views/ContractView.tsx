// Contract view — resolution banner, the price/volume chart with lifetime stats,
// a metadata grid ordered outcome → activity → dates, and sibling-contract
// navigation within the parent event.

import { Link, useParams } from "react-router-dom";

import { useContract, useEvent } from "../api/queries";
import type { ContractDetail, EventContract } from "../api/types";
import { Chip } from "../components/Chip";
import ContractChart from "../components/ContractChart";
import { ErrorNote, Loading } from "../components/Status";
import { fade, fmtCents, fmtCompact, fmtDate, fmtDuration, fmtInt, liftAccent } from "../lib/format";

const FALLBACK_ACCENT = "#9aa3b2";

export default function ContractView() {
  const { ticker = "" } = useParams();
  const query = useContract(ticker);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNote error={query.error} />;

  const data = query.data;
  const accent = liftAccent(data.color ?? FALLBACK_ACCENT);
  const backTo = data.event_ticker ? `/event/${encodeURIComponent(data.event_ticker)}` : "/";
  const lifespan = fmtDuration(data.first_trade ?? data.open_time, data.last_trade ?? data.close_time);

  return (
    <>
      <div className="mb-6">
        <Link to={backTo} className="text-sm text-ink-1 hover:text-ink-0">
          ‹ back to event
        </Link>
        <div className="my-2 text-title tracking-[-0.01em]">
          {data.title || data.ticker} <StatusChip contract={data} />
        </div>
        <div className="font-mono text-sm text-ink-1">
          {data.group ? (
            <>
              <Chip style={{ color: accent, borderColor: accent }}>{data.group}</Chip>
              {" \u00A0 "}
            </>
          ) : null}
          <span className="tabular-nums">{data.ticker}</span>
        </div>
      </div>

      <ResolutionBanner contract={data} lifespan={lifespan} />

      <ContractChart contract={data} />

      <div className="mt-12">
        <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-2">
          <p className="m-0 text-2xs uppercase tracking-[0.12em] text-ink-1">Details</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
          <Meta label="Status" value={data.status || "—"} />
          <Meta
            label="Result"
            value={data.result ? data.result.toUpperCase() : "—"}
            tone={data.result === "yes" ? "text-yes" : data.result === "no" ? "text-no" : undefined}
          />
          <Meta label="Last price" value={data.last_yes_price != null ? fmtCents(data.last_yes_price) : "—"} />
          <Meta label="Volume" value={fmtCompact(data.traded_volume)} />
          <Meta label="Trades" value={fmtInt(data.n_trades)} />
          <Meta label="Lifespan" value={lifespan ?? "—"} />
          <Meta label="First trade" value={fmtDate(data.first_trade)} />
          <Meta label="Last trade" value={fmtDate(data.last_trade)} />
          <Meta label="Opened" value={fmtDate(data.open_time)} />
          <Meta label="Closed" value={fmtDate(data.close_time)} />
        </div>
      </div>

      {data.event_ticker && <SiblingContracts eventTicker={data.event_ticker} current={data.ticker} />}
    </>
  );
}

function StatusChip({ contract }: { contract: ContractDetail }) {
  if (contract.status === "finalized" && contract.result) {
    return <Chip tone={contract.result === "yes" ? "yes" : "no"}>settled · {contract.result}</Chip>;
  }
  return <Chip>{contract.status || ""}</Chip>;
}

// The at-a-glance story for settled contracts: outcome, closing price, scale.
function ResolutionBanner({ contract, lifespan }: { contract: ContractDetail; lifespan: string | null }) {
  if (contract.status !== "finalized" || (contract.result !== "yes" && contract.result !== "no")) return null;
  const yes = contract.result === "yes";
  const color = yes ? "var(--color-yes)" : "var(--color-no)";
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-md border border-line border-l-[3px] px-4 py-3"
      style={{ borderLeftColor: color, background: fade(yes ? "#36d399" : "#f25c66", 0.05) }}
    >
      <span className={`font-mono text-xl font-semibold tracking-[0.06em] ${yes ? "text-yes" : "text-no"}`}>
        SETTLED {contract.result!.toUpperCase()}
      </span>
      {contract.last_yes_price != null && (
        <span className="font-mono text-sm text-ink-1">closed at {fmtCents(contract.last_yes_price)}</span>
      )}
      <span className="font-mono text-sm text-ink-1">
        {fmtCompact(contract.traded_volume)} contracts{lifespan != null ? ` over ${lifespan}` : ""}
      </span>
    </div>
  );
}

function Meta({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-[0.1em] text-ink-1">{label}</div>
      <div className={`mt-1 font-mono text-base tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

// The parent event's other contracts, with prev/next walking the event's
// volume-ranked order. Warm from the query cache when arriving off the event
// page; a decorative section, so errors render as nothing.
function SiblingContracts({ eventTicker, current }: { eventTicker: string; current: string }) {
  const query = useEvent(eventTicker);

  if (query.isPending) {
    return <div className="mt-12 font-mono text-sm text-ink-2">Loading event contracts…</div>;
  }
  if (query.isError) return null;

  const contracts = query.data.contracts;
  if (contracts.length < 2) return null;

  const idx = contracts.findIndex((c) => c.ticker === current);
  const prev = idx > 0 ? contracts[idx - 1] : null;
  const next = idx >= 0 && idx < contracts.length - 1 ? contracts[idx + 1] : null;

  return (
    <div className="mt-12">
      <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-2">
        <p className="m-0 text-2xs uppercase tracking-[0.12em] text-ink-1">Other contracts in this event</p>
        <span className="flex-1" />
        {prev && (
          <Link
            to={`/contract/${encodeURIComponent(prev.ticker)}`}
            className="font-mono text-2xs text-ink-1 hover:text-ink-0"
          >
            ‹ prev
          </Link>
        )}
        {next && (
          <Link
            to={`/contract/${encodeURIComponent(next.ticker)}`}
            className="font-mono text-2xs text-ink-1 hover:text-ink-0"
          >
            next ›
          </Link>
        )}
      </div>
      <div className="border-t border-line">
        {contracts.map((c) =>
          c.ticker === current ? (
            <div
              key={c.ticker}
              className="flex items-center gap-4 border-b border-l-[3px] border-line bg-bg-1 px-2 py-3"
              style={{ borderLeftColor: "var(--color-ink-2)" }}
            >
              <span className="min-w-0 flex-1 truncate">{c.title || c.ticker}</span>
              <span className="shrink-0 font-mono text-2xs uppercase tracking-[0.06em] text-ink-2">current</span>
            </div>
          ) : (
            <SiblingRow key={c.ticker} contract={c} />
          )
        )}
      </div>
    </div>
  );
}

function SiblingRow({ contract: c }: { contract: EventContract }) {
  return (
    <Link
      to={`/contract/${encodeURIComponent(c.ticker)}`}
      className="group flex cursor-pointer items-center gap-4 border-b border-l-[3px] border-line border-l-transparent px-2 py-3 transition-colors hover:bg-bg-1"
    >
      <span className="min-w-0 flex-1 truncate">{c.title || c.ticker}</span>
      <span className="w-[72px] shrink-0 text-right">
        {c.status === "finalized" && (c.result === "yes" || c.result === "no") ? (
          <Chip tone={c.result === "yes" ? "yes" : "no"}>{c.result}</Chip>
        ) : (
          <Chip>{c.status || "—"}</Chip>
        )}
      </span>
      <span className="w-24 shrink-0 text-right font-mono text-sm text-ink-0 tabular-nums">
        {fmtCompact(c.traded_volume)}
      </span>
      <span className="w-4 text-right text-ink-2 transition-transform group-hover:translate-x-[2px] group-hover:text-ink-0">
        →
      </span>
    </Link>
  );
}
