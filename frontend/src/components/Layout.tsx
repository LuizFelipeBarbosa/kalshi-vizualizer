import { Link, Outlet, useLocation } from "react-router-dom";

import { useSummary } from "../api/queries";
import { fmtRange } from "../lib/format";

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// "Events › {ticker}" on event/contract routes, ported from router.js renderCrumbs().
function Crumbs() {
  const { pathname } = useLocation();
  const match = pathname.match(/^\/(?:event|contract)\/(.+)$/);
  if (!match) return null;
  return (
    <nav className="flex items-center gap-2 text-sm text-ink-1">
      <Link to="/" className="hover:text-ink-0">
        Events
      </Link>
      <span className="text-ink-2">›</span>
      <span>{safeDecode(match[1])}</span>
    </nav>
  );
}

export default function Layout() {
  const { data: summary } = useSummary();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-line bg-bg-0/85 px-6 py-3 backdrop-blur-sm">
        <Link to="/" className="font-mono text-base font-semibold tracking-[0.08em]">
          KALSHI<span className="mx-[0.2em] text-ink-2">·</span>TAPE
        </Link>
        <Crumbs />
        <div className="flex-1" />
        <div className="font-mono text-2xs tracking-[0.04em] text-ink-2">
          {summary ? fmtRange(summary.first_trade, summary.last_trade) : ""}
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-6 pt-8 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
