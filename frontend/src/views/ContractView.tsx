// Contract view — the individual price line over the contract's lifetime + a synced
// volume strip, plus a metadata grid. Ported from the vanilla views/contract.js.

import { Link, useParams } from "react-router-dom";

import { useContract } from "../api/queries";
import type { ContractDetail } from "../api/types";
import { Chip } from "../components/Chip";
import ContractChart from "../components/ContractChart";
import { ErrorNote, Loading } from "../components/Status";
import { fmtCompact, fmtDate, fmtInt, fmtPct, liftAccent } from "../lib/format";

const FALLBACK_ACCENT = "#9aa3b2";

export default function ContractView() {
  const { ticker = "" } = useParams();
  const query = useContract(ticker);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNote error={query.error} />;

  const data = query.data;
  const accent = liftAccent(data.color ?? FALLBACK_ACCENT);
  const backTo = data.event_ticker ? `/event/${encodeURIComponent(data.event_ticker)}` : "/";

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

      <ContractChart contract={data} />

      <div className="mt-12">
        <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-2">
          <p className="m-0 text-2xs uppercase tracking-[0.12em] text-ink-1">Details</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
          <Meta label="Status" value={data.status || "—"} />
          <Meta label="Result" value={data.result ? data.result.toUpperCase() : "—"} />
          <Meta label="Last price" value={data.last_yes_price != null ? fmtPct(data.last_yes_price) : "—"} />
          <Meta label="Volume" value={fmtCompact(data.traded_volume)} />
          <Meta label="Trades" value={fmtInt(data.n_trades)} />
          <Meta label="First trade" value={fmtDate(data.first_trade)} />
          <Meta label="Last trade" value={fmtDate(data.last_trade)} />
          <Meta label="Opened" value={fmtDate(data.open_time)} />
          <Meta label="Closed" value={fmtDate(data.close_time)} />
        </div>
      </div>
    </>
  );
}

function StatusChip({ contract }: { contract: ContractDetail }) {
  if (contract.status === "finalized" && contract.result) {
    return <Chip tone={contract.result === "yes" ? "yes" : "no"}>settled · {contract.result}</Chip>;
  }
  return <Chip>{contract.status || ""}</Chip>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-[0.1em] text-ink-1">{label}</div>
      <div className="mt-1 font-mono text-base tabular-nums">{value}</div>
    </div>
  );
}
