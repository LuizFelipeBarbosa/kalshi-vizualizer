// Spike-scope landing page: the dataset's hero stats, group accents, and a ticker
// jump box into the migrated contract view. The full overview migrates next.

import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useSummary } from "../api/queries";
import { Chip } from "../components/Chip";
import { ErrorNote, Loading } from "../components/Status";
import { fmtCompact, liftAccent } from "../lib/format";

export default function HomeView() {
  const query = useSummary();
  const navigate = useNavigate();
  const [ticker, setTicker] = useState("");

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNote error={query.error} />;

  const summary = query.data;

  function jump(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (t) navigate(`/contract/${encodeURIComponent(t)}`);
  }

  return (
    <>
      <div className="flex flex-wrap gap-12">
        <Stat value={fmtCompact(summary.total_volume)} label="Volume" />
        <Stat value={fmtCompact(summary.n_trades)} label="Trades" />
        <Stat value={fmtCompact(summary.n_contracts)} label="Contracts" />
        <Stat value={fmtCompact(summary.n_events)} label="Events" />
      </div>

      <div className="mt-12">
        <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-2">
          <p className="m-0 text-2xs uppercase tracking-[0.12em] text-ink-1">Jump to a contract</p>
        </div>
        <form onSubmit={jump} className="flex max-w-md gap-3">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="ticker, e.g. INXD-23DEC29-B4787"
            className="w-full rounded-md border border-line bg-bg-1 px-3 py-2 font-mono text-sm text-ink-0 outline-none placeholder:text-ink-2 focus:border-ink-2"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-md border border-line bg-bg-1 px-3 py-2 font-mono text-sm hover:bg-bg-2"
          >
            open
          </button>
        </form>
        <p className="mt-3 font-mono text-2xs text-ink-2">
          The event and contract views are migrated; the full overview lands next.
        </p>
      </div>

      <div className="mt-12">
        <div className="mb-4 flex items-baseline gap-4 border-b border-line pb-2">
          <p className="m-0 text-2xs uppercase tracking-[0.12em] text-ink-1">Groups</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.groups.map((g) => (
            <Chip key={g.group} style={{ color: liftAccent(g.color), borderColor: liftAccent(g.color) }}>
              {g.group} · {fmtCompact(g.total_volume)}
            </Chip>
          ))}
        </div>
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
