// Token Radar, round 2 — the scoring model.
//
// Reads the sealed DefiLlama snapshot, finds the protocols that record no token
// and are not a wrapped, staked or bridged product of a token that already
// trades, and ranks them by an implied launch value derived from the snapshot
// itself: each protocol's TVL times the market multiple its own category
// earns, adjusted for seven-day growth, for how long it has run with no
// token, and for how many chains it runs on. Nothing here names a protocol:
// every number comes from the snapshot's figures, and the same code scores
// any snapshot with the same shape.

import { farmSteps } from './farm.ts';

// ------------------------------------------------------------------ types

/** One protocol exactly as the sealed snapshot carries it. */
export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot: a fetch date, a floor, every protocol, the watchlist. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

/** One ranked row of the board the gate reads. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** One row of the dashboard's data, with the model's working shown. */
export interface DetailRow {
  slug: string;
  name: string;
  rank: number;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  farm_steps: string[];
}

/** A protocol whose token already trades, shown only for contrast. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

/** Everything the dashboard page reads from data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: {
    name: string;
    version: string;
    growth_weight: number;
    growth_low: number;
    growth_high: number;
    maturity_floor: number;
    maturity_span: number;
    maturity_days: number;
    unknown_age_factor: number;
    breadth_step: number;
    breadth_max_chains: number;
    min_category_sample: number;
    global_multiple: number;
    multiple_cap: number;
  };
  counts: { protocols: number; watchlist: number; eligible: number; rows: number; live: number };
  rows: DetailRow[];
  live: LiveRow[];
}

/** The model's parameters, stated once so the page can show them. */
export const MODEL = {
  name: 'snapshot-median multiple',
  version: 'radar-2',
  growth_weight: 0.5,
  growth_low: -40,
  growth_high: 80,
  maturity_floor: 0.7,
  maturity_span: 0.5,
  maturity_days: 1095,
  unknown_age_factor: 0.85,
  breadth_step: 0.04,
  breadth_max_chains: 5,
  min_category_sample: 3,
} as const;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ------------------------------------------------------- eligibility rules

/** A name ending in a version marker: "Foo V2", "Foo v2", "Foo 2.0" and the like. */
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped, staked or bridged product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are a wrapped, staked or bridged product by definition. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol records a token: either of its token fields is set.
 * Saying it "records no token" is all the snapshot supports.
 */
export function recordsToken(p: SnapProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Whether the name or category marks a wrapped, staked or bridged product. */
export function looksWrapped(p: SnapProtocol): boolean {
  if (VERSION_TAIL.test(p.name)) return true;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix));
}

/** A radar candidate: no token on record, and not a wrapped product of one. */
export function isEligible(p: SnapProtocol): boolean {
  return !recordsToken(p) && !looksWrapped(p);
}

// ------------------------------------------------------------- small maths

/** The middle value of a sorted list, or null when the list is empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from a listing date to the snapshot's date, or null. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86_400_000);
}

/** Clamp a number into a closed interval. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// ------------------------------------------------------------ the multiple

/**
 * For every category, the median market-cap-per-TVL of its protocols whose
 * token already trades; plus the same median across all such protocols.
 * A category sets its own multiple only when at least three of its
 * protocols trade — a single comp can be a wild outlier (one tiny-TVL
 * protocol with a large market cap) — and no multiple runs past the 90th
 * percentile of all the ratios. A category with too few traded tokens
 * falls back to the global median, so the multiple is always the
 * snapshot's own figure, never a typed-in guess.
 */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, number>; global: number; cap: number } {
  const perCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const bucket = perCategory.get(key);
    if (bucket === undefined) perCategory.set(key, [ratio]);
    else bucket.push(ratio);
  }
  const global = median(all) ?? 0.2;
  const sorted = [...all].sort((a, b) => a - b);
  const cap = sorted.length === 0 ? 1 : sorted[Math.min(sorted.length - 1, Math.floor(0.9 * (sorted.length - 1)))]!;
  const byCategory = new Map<string, number>();
  for (const [key, values] of perCategory) {
    if (values.length < MODEL.min_category_sample) continue;
    const middle = median(values);
    if (middle !== null) byCategory.set(key, Math.min(middle, cap));
  }
  return { byCategory, global: Math.min(global, cap), cap };
}

// ---------------------------------------------------------- implied value

/** The implied value and the four factors that built it, for one protocol. */
export interface Implied {
  implied: number;
  multiple: number;
  growthFactor: number;
  maturityFactor: number;
  breadthFactor: number;
  age: number | null;
}

export function impliedValue(
  p: SnapProtocol,
  asOf: string,
  multiples: { byCategory: Map<string, number>; global: number; cap: number },
): Implied {
  const categoryMultiple = multiples.byCategory.get(p.category ?? 'Uncategorised') ?? multiples.global;
  const multiple = Math.min(categoryMultiple, multiples.cap);
  const change = p.change_7d === null ? 0 : clamp(p.change_7d, MODEL.growth_low, MODEL.growth_high);
  const growthFactor = 1 + MODEL.growth_weight * (change / 100);
  const age = ageDays(asOf, p.listed_at);
  const maturityFactor =
    age === null
      ? MODEL.unknown_age_factor
      : MODEL.maturity_floor + MODEL.maturity_span * (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days);
  const chainCount = Math.max(1, p.chains.length);
  const breadthFactor = 1 + MODEL.breadth_step * (Math.min(chainCount, MODEL.breadth_max_chains + 1) - 1);
  const raw = p.tvl_usd * multiple * growthFactor * maturityFactor * breadthFactor;
  const implied = Math.max(1, Math.min(100_000_000_000_000, Math.round(raw)));
  return { implied, multiple, growthFactor, maturityFactor, breadthFactor, age };
}

// ------------------------------------------------------------------ build

/** Parse and check the sealed snapshot's text. */
export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotError('the snapshot is not an object');
  }
  const snap = parsed as Record<string, unknown>;
  if (!Array.isArray(snap.protocols)) throw new SnapshotError('the snapshot holds no protocols array');
  if (!Array.isArray(snap.watchlist)) throw new SnapshotError('the snapshot holds no watchlist array');
  if (typeof snap.as_of !== 'string') throw new SnapshotError('the snapshot holds no as_of date');
  if (typeof snap.floor_usd !== 'number') throw new SnapshotError('the snapshot holds no floor_usd');
  const protocols = snap.protocols as SnapProtocol[];
  for (const p of protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new SnapshotError('a protocol is missing its slug, name or tvl_usd');
    }
  }
  return {
    as_of: snap.as_of,
    source: typeof snap.source === 'string' ? snap.source : '',
    floor_usd: snap.floor_usd,
    protocols,
    watchlist: snap.watchlist as string[],
  };
}

/**
 * Score every eligible protocol and rank it. Ties on implied value break by
 * the larger TVL, then by slug, so the order is the same on every run.
 */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; detail: DetailRow[]; multiples: { byCategory: Map<string, number>; global: number; cap: number } } {
  const multiples = categoryMultiples(snapshot);
  const scored = snapshot.protocols
    .filter(isEligible)
    .map((p) => ({ p, scored: impliedValue(p, snapshot.as_of, multiples) }))
    .sort((a, b) => {
      if (b.scored.implied !== a.scored.implied) return b.scored.implied - a.scored.implied;
      if (b.p.tvl_usd !== a.p.tvl_usd) return b.p.tvl_usd - a.p.tvl_usd;
      return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
    });
  const watchlist = new Set(snapshot.watchlist);
  const board: BoardRow[] = [];
  const detail: DetailRow[] = [];
  scored.forEach(({ p, scored }, index) => {
    const steps = farmSteps(p, scored.age);
    board.push({ slug: p.slug, name: p.name, rank: index + 1, implied_value_usd: scored.implied, farm_steps: steps });
    detail.push({
      slug: p.slug,
      name: p.name,
      rank: index + 1,
      category: p.category ?? 'Uncategorised',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: scored.age,
      listed_at: p.listed_at,
      on_watchlist: watchlist.has(p.slug),
      implied_value_usd: scored.implied,
      multiple: scored.multiple,
      growth_factor: scored.growthFactor,
      maturity_factor: scored.maturityFactor,
      breadth_factor: scored.breadthFactor,
      farm_steps: steps,
    });
  });
  return { board, detail, multiples };
}

/**
 * The contrast set: the twelve protocols whose token already trades, by
 * market cap, so the page can show what "already launched" looks like
 * beside the board. They are never ranked and never enter board.json.
 */
export function liveContrast(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 12)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      mcap_usd: p.mcap_usd ?? 0,
      tvl_usd: p.tvl_usd,
      multiple: p.tvl_usd > 0 ? (p.mcap_usd ?? 0) / p.tvl_usd : 0,
    }));
}

/** Bundle the board, the contrast set and the model's own numbers for the page. */
export function assembleRadar(snapshot: Snapshot, board: BoardRow[], detail: DetailRow[], multiples: { byCategory: Map<string, number>; global: number; cap: number }): RadarData {
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { ...MODEL, global_multiple: multiples.global, multiple_cap: multiples.cap },
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      eligible: board.length,
      rows: board.length,
      live: 12,
    },
    rows: detail,
    live: liveContrast(snapshot),
  };
}

/** The dashboard's data file: one assignment, no network, no code. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ------------------------------------------------------------- gate check

/**
 * The gate's own shape, checked before anything is written: row count,
 * watchlist coverage, ranks 1..N, values that never rise with rank, and
 * farm steps of the right length. Returns the first problem, or null.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate needs`;
  if (board.length > 4000) return `the board holds ${board.length} rows, over the 4000 the gate allows`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug} names a protocol the snapshot does not list`;
    if (seen.has(row.slug)) return `row ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank < 1 || !Number.isInteger(row.rank)) return `row ${row.slug} has a rank that is not a positive whole number`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} has an implied value that is not a positive whole number of dollars`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} holds ${row.farm_steps.length} farm steps, not 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} holds a farm step of ${trimmed.length} characters, not 20 to 600`;
      }
    }
  }
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `the ranks are not exactly 1 to ${board.length}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${board[i]!.slug} is worth more than the row ranked above it`;
    }
  }
  const watchlist = new Set(snapshot.watchlist);
  for (const slug of watchlist) {
    if (!seen.has(slug)) return `the watchlist protocol ${slug} is missing from the board`;
  }
  if (board.length >= 2 && board.every((row) => row.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every row carries the same implied value, so the board ranks nothing';
  }
  return null;
}
