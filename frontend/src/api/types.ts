// Response shapes for the FastAPI JSON API (src/visualize/queries.py).
// Timestamps are epoch seconds; prices are Kalshi cents (1-99) which the UI
// renders on a 0-100% probability axis.

export interface GroupRollup {
  group: string;
  color: string;
  n_events: number;
  n_contracts: number;
  total_volume: number;
}

export interface Summary {
  n_events: number;
  n_contracts: number;
  n_traded_contracts: number;
  total_volume: number;
  n_trades: number;
  first_trade: number | null;
  last_trade: number | null;
  groups: GroupRollup[];
}

export interface EventSummary {
  event_ticker: string;
  group: string | null;
  category: string | null;
  subcategory: string | null;
  color: string | null;
  sample_title: string | null;
  n_contracts: number | null;
  n_traded_contracts: number | null;
  total_volume: number | null;
  first_trade: number | null;
  last_trade: number | null;
  has_open: boolean | null;
}

export interface EventsPage {
  events: EventSummary[];
  page: number;
  page_size: number;
  total_pages: number;
  total: number;
}

export interface EventsParams {
  group: string;
  q: string;
  sort: string;
  page: number;
}

export interface PricePoint {
  t: number;
  price: number;
  volume: number;
}

// Minimal point for sparklines; PricePoint satisfies it structurally.
export interface SparkPoint {
  t: number;
  price: number;
}

// One spotlight item from /api/highlights. Flat stats mirror the backend row;
// `category` is an open set — the UI must degrade gracefully on unknown tags.
export interface Highlight {
  category: string;
  rank: number;
  ticker: string;
  event_ticker: string | null;
  title: string | null;
  status: string | null;
  result: string | null;
  group: string | null;
  color: string | null;
  traded_volume: number;
  n_trades: number;
  first_trade: number | null;
  last_trade: number | null;
  duration_s: number | null;
  min_price: number;
  max_price: number;
  price_range: number;
  vwap: number | null;
  min_price_t: number | null;
  max_price_t: number | null;
  first_price: number;
  last_price: number;
  last_yes_price: number | null;
  sparkline: SparkPoint[];
}

export interface HighlightsResponse {
  highlights: Highlight[];
  categories: string[];
}

export interface SeriesEntry {
  ticker: string;
  points: PricePoint[];
}

export interface EventContract {
  ticker: string;
  title: string | null;
  status: string | null;
  result: string | null;
  market_volume: number | null;
  traded_volume: number | null;
  n_trades: number | null;
  open_time: number | null;
  close_time: number | null;
  first_trade: number | null;
  last_trade: number | null;
  last_yes_price: number | null;
}

export interface EventDetail {
  event_ticker: string;
  group: string | null;
  category: string | null;
  subcategory: string | null;
  color: string | null;
  title: string | null;
  n_contracts: number | null;
  total_volume: number | null;
  first_trade: number | null;
  last_trade: number | null;
  contracts: EventContract[];
  series: SeriesEntry[];
}

export interface ContractDetail {
  ticker: string;
  event_ticker: string | null;
  title: string | null;
  status: string | null;
  result: string | null;
  market_volume: number | null;
  traded_volume: number | null;
  n_trades: number | null;
  open_time: number | null;
  close_time: number | null;
  first_trade: number | null;
  last_trade: number | null;
  last_yes_price: number | null;
  // Enriched from the parent event so the view can theme the chart.
  group?: string | null;
  color?: string | null;
  points: PricePoint[];
}
