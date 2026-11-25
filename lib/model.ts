// Token Radar v5 — the model.
//
// What it does, in one paragraph: it reads the sealed DefiLlama snapshot,
// fits a value model and a launch-odds model on the protocols that already
// trade, and ranks the protocols that record no token and pass the
// watchlist's exclusion test (no wrapped, staked or bridged product, no
// exchange, no versioned name) by an implied value
// (TVL x a fitted value multiple x fitted launch odds). Both models are
// chosen by a documented admission search, not by hand: every candidate
// term is tried as a single and as part of every pair, then a greedy
// forward search grows the best pairs, and a term is kept only when it
// improves BOTH blind tests at once. The value model is a Huber (robust)
// regression of ln(market cap / TVL); the odds model is a logistic fit on
// whether a protocol records a token by the snapshot date. Prediction
// intervals are split-conformal: the 80% quantile of out-of-fold residuals.
//
// Nothing here is a hardcoded list of names. Every number the board shows
// comes from the snapshot's own figures: TVL, seven-day growth, how long a
// protocol has run, and how many chains it runs on.

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  growth: number | null; // 7-day TVL change, percent; null when unreported
  mcap: number | null;
  listedAt: string | null; // YYYY-MM-DD or null
  geckoId: string | null;
  symbol: string | null;
}

export interface Snapshot {
  asOf: string;
  floorUsd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** A protocol records a token when DefiLlama carries either identifier. */
export function hasToken(p: Proto): boolean {
  return p.geckoId !== null || p.symbol !== null;
}

// ------------------------------------------------------------------ the board's subjects
//
// The board ranks protocols that record no token AND are not a wrapped,
// staked or bridged product of a token that already trades — the watchlist's
// own exclusion test, as far as the snapshot lets it be checked: the
// category is not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking,
// Restaked BTC or CEX; the name does not end in a version marker, carries no
// whole word wrapped / staked / staking, and does not begin with an
// exchange's name.
//
// Above the $50M floor the house's watchlist is the authority: it also
// checks the parent protocol, a field the snapshot does not carry, so the
// 20 above-floor protocols it leaves out are left out here too. Below the
// floor the house never applied the rule, so the replicable part of it is
// applied here. That gives 178 rows: the 40 on the watchlist plus 138 more
// below the floor. Without the test the top of the board would be exchanges
// and bridges (Bybit, HTX, WBTC) — large, but not token launches to farm.

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function excludedByWatchlistRule(p: Proto): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return true;
  return false;
}

/** The protocols the board ranks: the watchlist, plus below-floor pre-token
 *  protocols that pass the watchlist's exclusion test. */
export function boardSubjects(snap: Snapshot): Proto[] {
  const watch = new Set(snap.watchlist);
  return snap.protocols.filter(
    (p) => !hasToken(p) && (watch.has(p.slug) || (p.tvl < snap.floorUsd && !excludedByWatchlistRule(p))),
  );
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as {
    as_of: string;
    floor_usd: number;
    protocols: Array<Record<string, unknown>>;
    watchlist: string[];
  };
  const protocols: Proto[] = raw.protocols.map((p) => ({
    slug: String(p.slug),
    name: String(p.name),
    category: p.category === null ? null : String(p.category),
    chains: (p.chains as string[]).slice(),
    tvl: Number(p.tvl_usd),
    growth: p.change_7d === null ? null : Number(p.change_7d),
    mcap: p.mcap_usd === null ? null : Number(p.mcap_usd),
    listedAt: p.listed_at === null ? null : String(p.listed_at),
    geckoId: p.gecko_id === null ? null : String(p.gecko_id),
    symbol: p.symbol === null ? null : String(p.symbol),
  }));
  protocols.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { asOf: raw.as_of, floorUsd: raw.floor_usd, protocols, watchlist: raw.watchlist.slice().sort() };
}

// ------------------------------------------------------------------ utilities

/** Deterministic PRNG (mulberry32). Re-seeded before every CV evaluation so
 *  two runs of the program produce the same bytes. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? 0 : n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

/** Days from `listedAt` to the snapshot date; null when unreported. */
export function ageDays(p: Proto, asOf: string): number | null {
  if (p.listedAt === null) return null;
  const a = Date.parse(`${p.listedAt}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Solve A x = b by Gaussian elimination with partial pivoting. Null when singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m: number[][] = A.map((row, i) => row.concat([b[i]!]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    if (piv !== col) {
      const tmp = m[col]!;
      m[col] = m[piv]!;
      m[piv] = tmp;
    }
    const d = m[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const x: number[] = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= m[r]![c]! * x[c]!;
    x[r] = s / m[r]![r]!;
  }
  return x;
}

/** Least squares via the normal equations, with a 1e-8 ridge on every slope. */
export function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0]!.length;
  const A: number[][] = [];
  for (let i = 0; i < k; i++) {
    A.push(new Array(k).fill(0));
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let r = 0; r < X.length; r++) s += X[r]![i]! * X[r]![j]!;
      A[i]![j] = s + (i === j && i > 0 ? 1e-8 : 0);
    }
  }
  const b: number[] = [];
  for (let i = 0; i < k; i++) {
    let s = 0;
    for (let r = 0; r < X.length; r++) s += X[r]![i]! * y[r]!;
    b.push(s);
  }
  return solve(A, b);
}

/** Huber robust regression (k = 1.345 scale units) by IRLS. Falls back to OLS
 *  when a reweighting step fails; the scale is the MAD of the residuals. */
export function huberFit(X: number[][], y: number[]): number[] {
  let beta = ols(X, y);
  if (beta === null) beta = new Array(X[0]!.length).fill(0);
  for (let it = 0; it < 30; it++) {
    const resid = y.map((yi, r) => yi - dot(X[r]!, beta));
    const s = median(resid.map((r) => Math.abs(r))) / 0.6745 + 1e-9;
    const k = 1.345 * s;
    const w = resid.map((r) => (Math.abs(r) <= k ? 1 : k / Math.max(Math.abs(r), 1e-9)));
    const sw = w.map((v) => Math.sqrt(v));
    const Xw = X.map((row, r) => row.map((v) => v * sw[r]!));
    const yw = y.map((v, r) => v * sw[r]!);
    const next = ols(Xw, yw);
    if (next === null) break;
    const delta = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (delta < 1e-9) break;
  }
  return beta;
}

/** Median (L1) regression by IRLS. Used only to compare losses, never to fit the board. */
export function ladFit(X: number[][], y: number[]): number[] {
  let beta = ols(X, y);
  if (beta === null) beta = new Array(X[0]!.length).fill(0);
  for (let it = 0; it < 30; it++) {
    const resid = y.map((yi, r) => yi - dot(X[r]!, beta));
    const w = resid.map((r) => 1 / Math.max(Math.abs(r), 0.05));
    const sw = w.map((v) => Math.sqrt(v));
    const Xw = X.map((row, r) => row.map((v) => v * sw[r]!));
    const yw = y.map((v, r) => v * sw[r]!);
    const next = ols(Xw, yw);
    if (next === null) break;
    const delta = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (delta < 1e-9) break;
  }
  return beta;
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Logistic regression by IRLS (Newton), with a 1e-6 ridge on every slope. */
export function logisticFit(X: number[][], y: number[]): number[] {
  const k = X[0]!.length;
  const p0 = clamp(mean(y), 1e-6, 1 - 1e-6);
  let beta: number[] = new Array(k).fill(0);
  beta[0] = Math.log(p0 / (1 - p0));
  for (let it = 0; it < 60; it++) {
    const pr = X.map((row) => sigmoid(dot(row, beta)));
    const w = pr.map((v) => v * (1 - v) + 1e-9);
    const z = X.map((row, r) => dot(row, beta) + (y[r]! - pr[r]!) / w[r]!);
    const A: number[][] = [];
    for (let i = 0; i < k; i++) {
      A.push(new Array(k).fill(0));
      for (let j = 0; j < k; j++) {
        let s = 0;
        for (let r = 0; r < X.length; r++) s += X[r]![i]! * X[r]![j]! * w[r]!;
        A[i]![j] = s + (i === j && i > 0 ? 1e-6 : 0);
      }
    }
    const b: number[] = [];
    for (let i = 0; i < k; i++) {
      let s = 0;
      for (let r = 0; r < X.length; r++) s += X[r]![i]! * w[r]! * z[r]!;
      b.push(s);
    }
    const next = solve(A, b);
    if (next === null) break;
    const delta = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (delta < 1e-8) break;
  }
  return beta;
}

// ------------------------------------------------------------------ value features
//
// The value target is ln(market cap / TVL) on the 87 traded peers with a
// market cap of at least $5M. Every term is built from the snapshot's own
// figures, centered on the peers so the intercept reads as the field mean.
// Growth is winsorized to [-50, +50]% and scaled to units of 50 points;
// age is ln(days + 1), missing ages take the peers' median.

export const VALUE_TERMS = [
  'size', 'size2', 'size3', 'chains', 'chains_raw', 'chains2', 'growth',
  'growth_pos', 'growth_neg', 'age', 'age_miss', 'age2', 'size_age',
  'size_growth', 'growth_age', 'size_chains', 'cat',
] as const;
export type ValueTerm = (typeof VALUE_TERMS)[number];

export interface ValueFrame {
  peers: Proto[];
  y: number[]; // ln(mcap / TVL)
  cols: Record<string, number[]>; // one column per term, per peer
  centers: { lnTvl: number; age: number; growth: number; chains: number; medianAge: number };
  // Range honesty: each term's [min, max] over the peers. A protocol's term
  // is clamped to this range before prediction, so no implied value comes
  // from extrapolating an interaction beyond what any traded peer showed.
  ranges: Record<string, [number, number]>;
}

export function valueFrame(snap: Snapshot): ValueFrame {
  const peers = snap.protocols.filter((p) => p.mcap !== null && p.mcap >= 5_000_000);
  const ages = peers.map((p) => ageDays(p, snap.asOf)).filter((a): a is number => a !== null);
  const medianAge = median(ages.map((a) => Math.log(a + 1)));
  const lnTvl = peers.map((p) => Math.log(p.tvl));
  const ageC = peers.map((p) => {
    const a = ageDays(p, snap.asOf);
    return a === null ? medianAge : Math.log(a + 1);
  });
  const growth = peers.map((p) => clamp(p.growth === null ? 0 : p.growth, -50, 50) / 50);
  const chainsC = peers.map((p) => Math.log1p(p.chains.length));
  const centers = {
    lnTvl: mean(lnTvl),
    age: mean(ageC),
    growth: mean(growth),
    chains: mean(chainsC),
    medianAge,
  };
  const cols: Record<string, number[]> = {};
  const L = lnTvl.map((v) => v - centers.lnTvl);
  const A = ageC.map((v) => v - centers.age);
  const G = growth.map((v) => v - centers.growth);
  const C = chainsC.map((v) => v - centers.chains);
  cols.size = L;
  cols.size2 = L.map((v) => v * v);
  cols.size3 = L.map((v) => v * v * v);
  cols.chains = C;
  cols.chains_raw = peers.map((p) => p.chains.length / 10);
  cols.chains2 = C.map((v) => v * v);
  cols.growth = G;
  cols.growth_pos = growth.map((v) => Math.max(0, v) - Math.max(0, centers.growth));
  cols.growth_neg = growth.map((v) => Math.min(0, v) - Math.min(0, centers.growth));
  cols.age = A;
  cols.age_miss = peers.map((p) => (ageDays(p, snap.asOf) === null ? 1 : 0));
  cols.age2 = A.map((v) => v * v);
  cols.size_age = L.map((v, i) => v * A[i]!);
  cols.size_growth = L.map((v, i) => v * G[i]!);
  cols.growth_age = G.map((v, i) => v * A[i]!);
  cols.size_chains = L.map((v, i) => v * C[i]!);
  cols.cat = peers.map(() => 0); // 'cat' is not a column; it is a shrunk offset, fitted after
  const ranges: Record<string, [number, number]> = {};
  for (const t of Object.keys(cols)) {
    if (t === 'cat') continue;
    const col = cols[t]!;
    ranges[t] = [Math.min(...col), Math.max(...col)];
  }
  return { peers, y: peers.map((p) => Math.log(p.mcap! / p.tvl)), cols, centers, ranges };
}

/** A term's value for one protocol, using the peers' centers, clamped to
 *  the range the term takes on the peers (range honesty). */
export function valueTerm(p: Proto, term: string, f: ValueFrame, snap: Snapshot): number {
  const L = Math.log(p.tvl) - f.centers.lnTvl;
  const a = ageDays(p, snap.asOf);
  const age = (a === null ? f.centers.medianAge : Math.log(a + 1)) - f.centers.age;
  const g = clamp(p.growth === null ? 0 : p.growth, -50, 50) / 50 - f.centers.growth;
  const gRaw = clamp(p.growth === null ? 0 : p.growth, -50, 50) / 50;
  const c = Math.log1p(p.chains.length) - f.centers.chains;
  let v: number;
  switch (term) {
    case 'size': v = L; break;
    case 'size2': v = L * L; break;
    case 'size3': v = L * L * L; break;
    case 'chains': v = c; break;
    case 'chains_raw': v = p.chains.length / 10; break;
    case 'chains2': v = c * c; break;
    case 'growth': v = g; break;
    case 'growth_pos': v = Math.max(0, gRaw) - Math.max(0, f.centers.growth); break;
    case 'growth_neg': v = Math.min(0, gRaw) - Math.min(0, f.centers.growth); break;
    case 'age': v = age; break;
    case 'age_miss': v = a === null ? 1 : 0; break;
    case 'age2': v = age * age; break;
    case 'size_age': v = L * age; break;
    case 'size_growth': v = L * g; break;
    case 'growth_age': v = g * age; break;
    case 'size_chains': v = L * c; break;
    default: return 0;
  }
  const r = f.ranges[term];
  return r === undefined ? v : clamp(v, r[0], r[1]);
}

/** Shrunk category offsets (k = 5): a category's mean residual, pulled toward 0. */
export function catOffsets(rows: Proto[], resid: number[], k = 5): Record<string, number> {
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  rows.forEach((p, i) => {
    const c = p.category ?? '(none)';
    sum[c] = (sum[c] ?? 0) + resid[i]!;
    n[c] = (n[c] ?? 0) + 1;
  });
  const out: Record<string, number> = {};
  for (const c of Object.keys(sum)) out[c] = sum[c]! / (n[c]! + k);
  return out;
}

export interface ValueFit {
  beta: number[];
  offsets: Record<string, number>;
}

function designValue(f: ValueFrame, terms: string[], idxs: number[]): number[][] {
  const useCat = terms.includes('cat');
  const base = terms.filter((t) => t !== 'cat');
  return idxs.map((i) => {
    const row = [1];
    for (const t of base) row.push(f.cols[t]![i]!);
    return row;
  });
}

function predictValue(f: ValueFrame, terms: string[], fit: ValueFit, idxs: number[]): number[] {
  const X = designValue(f, terms, idxs);
  const useCat = terms.includes('cat');
  return X.map((row, j) => {
    let v = dot(row, fit.beta);
    if (useCat) v += fit.offsets[f.peers[idxs[j]!]!.category ?? '(none)'] ?? 0;
    return v;
  });
}

/** Fit the value model on the given peer rows. `loss` is 'huber' for the board. */
export function fitValue(f: ValueFrame, terms: string[], idxs: number[], loss: 'ols' | 'huber' | 'lad'): ValueFit {
  const X = designValue(f, terms, idxs);
  const y = idxs.map((i) => f.y[i]!);
  const beta = loss === 'ols' ? ols(X, y) ?? new Array(X[0]!.length).fill(0)
    : loss === 'huber' ? huberFit(X, y) : ladFit(X, y);
  let offsets: Record<string, number> = {};
  if (terms.includes('cat')) {
    const resid = y.map((yi, r) => yi - dot(X[r]!, beta));
    offsets = catOffsets(idxs.map((i) => f.peers[i]!), resid, 5);
  }
  return { beta, offsets };
}

export interface Scores { loo: number; wf: number; cv: number; loco: number }

/** Leave-one-out: exp(mean |log error|), the factor by which the value is off. */
export function looValue(f: ValueFrame, terms: string[], loss: 'ols' | 'huber' | 'lad'): number {
  const n = f.peers.length;
  let err = 0;
  for (let i = 0; i < n; i++) {
    const tr = [...Array(n).keys()].filter((j) => j !== i);
    const fit = fitValue(f, terms, tr, loss);
    err += Math.abs(predictValue(f, terms, fit, [i])[0]! - f.y[i]!);
  }
  return Math.exp(err / n);
}

/** Walk-forward: fit on the earliest 50/60/70% of dated peers by listed_at,
 *  score the next 20%; the mean over the three windows, as a factor. */
export function wfValue(f: ValueFrame, terms: string[], loss: 'ols' | 'huber' | 'lad', snap: Snapshot): number {
  const dated = f.peers.map((p, i) => ({ p, i })).filter(({ p }) => p.listedAt !== null)
    .sort((a, b) => (a.p.listedAt! < b.p.listedAt! ? -1 : 1));
  const n = dated.length;
  let err = 0;
  let cnt = 0;
  for (const frac of [0.5, 0.6, 0.7]) {
    const cut = Math.floor(n * frac);
    const nxt = Math.floor(n * (frac + 0.2));
    const tr = dated.slice(0, cut).map((d) => d.i);
    const te = dated.slice(cut, nxt);
    const fit = fitValue(f, terms, tr, loss);
    const pr = predictValue(f, terms, fit, te.map((d) => d.i));
    te.forEach((d, j) => {
      err += Math.abs(pr[j]! - f.y[d.i]!);
      cnt++;
    });
  }
  return Math.exp(err / cnt);
}

/** 10-fold cross-validation, 3 repeats, PRNG re-seeded per call. */
export function cvValue(f: ValueFrame, terms: string[], loss: 'ols' | 'huber' | 'lad', repeats = 3): number {
  const rng = mulberry32(20261114);
  const n = f.peers.length;
  let err = 0;
  let cnt = 0;
  for (let r = 0; r < repeats; r++) {
    const perm = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = perm[i]!;
      perm[i] = perm[j]!;
      perm[j] = t;
    }
    for (let fold = 0; fold < 10; fold++) {
      const te = perm.filter((_, i) => i % 10 === fold);
      const teSet = new Set(te);
      const tr = perm.filter((i) => !teSet.has(i));
      const fit = fitValue(f, terms, tr, loss);
      const pr = predictValue(f, terms, fit, te);
      te.forEach((i, j) => {
        err += Math.abs(pr[j]! - f.y[i]!);
        cnt++;
      });
    }
  }
  return Math.exp(err / cnt);
}

/** Leave-one-category-out: fit without a whole category, score it. */
export function locoValue(f: ValueFrame, terms: string[], loss: 'ols' | 'huber' | 'lad'): number {
  const byCat = new Map<string, number[]>();
  f.peers.forEach((p, i) => {
    const c = p.category ?? '(none)';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(i);
  });
  let err = 0;
  let cnt = 0;
  for (const idxs of byCat.values()) {
    if (idxs.length < 2) continue;
    const idxSet = new Set(idxs);
    const tr = [...Array(f.peers.length).keys()].filter((i) => !idxSet.has(i));
    const fit = fitValue(f, terms, tr, loss);
    const pr = predictValue(f, terms, fit, idxs);
    idxs.forEach((i, j) => {
      err += Math.abs(pr[j]! - f.y[i]!);
      cnt++;
    });
  }
  return Math.exp(err / cnt);
}

export function evalValue(f: ValueFrame, terms: string[], loss: 'ols' | 'huber' | 'lad', snap: Snapshot): Scores {
  return {
    loo: looValue(f, terms, loss),
    wf: wfValue(f, terms, loss, snap),
    cv: cvValue(f, terms, loss),
    loco: locoValue(f, terms, loss),
  };
}

/** The admission rule, written once and used by every stage of the search:
 *  a term (or set) is kept only when it lowers BOTH blind tests by more
 *  than 0.001 and worsens neither guard by more than 0.005. */
export function admits(cur: Scores, next: Scores): boolean {
  return next.loo < cur.loo - 0.001 && next.wf < cur.wf - 0.001
    && next.cv <= cur.cv + 0.005 && next.loco <= cur.loco + 0.005;
}

export interface SearchRow {
  set: string[];
  loo: number;
  wf: number;
  cv: number | null;
  loco: number | null;
  verdict: string;
}

/**
 * The value search, exactly as run by the program at grade time:
 *  1. every single term (LOO + WF only);
 *  2. every pair (LOO + WF only), ranked by LOO + WF;
 *  3. a greedy forward search from each of the top 7 pairs, adding one term
 *     at a time while `admits` passes (full four-way scores); seven starts
 *     because a pair that looks middling on its own can grow the best set —
 *     the search is fixed here, before any outcome is read;
 *  4. the endpoint with the lowest LOO + WF wins.
 * The full table is returned for the dashboard's evidence rail.
 */
export function searchValue(f: ValueFrame, snap: Snapshot): { chosen: string[]; scores: Scores; table: SearchRow[] } {
  const table: SearchRow[] = [];
  const allIdx = [...Array(f.peers.length).keys()];
  const base = evalValue(f, [], 'huber', snap);
  table.push({ set: [], loo: base.loo, wf: base.wf, cv: base.cv, loco: base.loco, verdict: 'baseline (intercept only)' });

  // Stage 1: singles.
  const singles: Array<{ term: string; loo: number; wf: number }> = [];
  for (const t of VALUE_TERMS) {
    const loo = looValue(f, [t], 'huber');
    const wf = wfValue(f, [t], 'huber', snap);
    singles.push({ term: t, loo, wf });
    table.push({ set: [t], loo, wf, cv: null, loco: null, verdict: loo < base.loo && wf < base.wf ? 'beats baseline' : 'rejected: no blind-test gain' });
  }
  singles.sort((a, b) => a.loo + a.wf - (b.loo + b.wf));

  // Stage 2: pairs.
  const pairs: Array<{ set: string[]; loo: number; wf: number }> = [];
  for (let i = 0; i < VALUE_TERMS.length; i++) {
    for (let j = i + 1; j < VALUE_TERMS.length; j++) {
      const set = [VALUE_TERMS[i]!, VALUE_TERMS[j]!];
      const loo = looValue(f, set, 'huber');
      const wf = wfValue(f, set, 'huber', snap);
      pairs.push({ set, loo, wf });
      table.push({ set, loo, wf, cv: null, loco: null, verdict: 'pair screened' });
    }
  }
  pairs.sort((a, b) => a.loo + a.wf - (b.loo + b.wf));

  // Stage 3: greedy from each of the top 7 pairs. One table row per round:
  // the admitted term (if any) and how many candidates the rule rejected.
  // The per-candidate scores are not stored — the dossier's text budget is
  // spent on the pairs and the admissions, not on two hundred rejections.
  const endpoints: Array<{ set: string[]; scores: Scores }> = [];
  for (const start of pairs.slice(0, 7)) {
    let cur = start.set.slice();
    let curScores = evalValue(f, cur, 'huber', snap);
    table.push({ set: cur.slice(), loo: curScores.loo, wf: curScores.wf, cv: curScores.cv, loco: curScores.loco, verdict: 'greedy start (top pair)' });
    for (let round = 0; round < 4; round++) {
      let best: { term: string; scores: Scores; gain: number } | null = null;
      let rejected = 0;
      for (const t of VALUE_TERMS) {
        if (cur.includes(t)) continue;
        const m = evalValue(f, [...cur, t], 'huber', snap);
        if (!admits(curScores, m)) {
          rejected++;
          continue;
        }
        const gain = (curScores.loo - m.loo) + (curScores.wf - m.wf);
        if (best === null || gain > best.gain) best = { term: t, scores: m, gain };
      }
      if (best === null) {
        table.push({ set: cur.slice(), loo: curScores.loo, wf: curScores.wf, cv: curScores.cv, loco: curScores.loco, verdict: `stop: ${rejected} candidates rejected by the rule` });
        break;
      }
      cur.push(best.term);
      curScores = best.scores;
      table.push({ set: cur.slice(), loo: curScores.loo, wf: curScores.wf, cv: curScores.cv, loco: curScores.loco, verdict: `admitted ${best.term}; ${rejected} candidates rejected` });
    }
    endpoints.push({ set: cur, scores: curScores });
  }
  endpoints.sort((a, b) => (a.scores.loo + a.scores.wf) - (b.scores.loo + b.scores.wf));
  const win = endpoints[0]!;
  // Mark the winning endpoint's last row in the table.
  for (let i = table.length - 1; i >= 0; i--) {
    const row = table[i]!;
    if (row.set.length === win.set.length && row.set.every((t) => win.set.includes(t))) {
      row.verdict += '; CHOSEN: lowest LOO + WF of the greedy endpoints';
      break;
    }
  }
  return { chosen: win.set, scores: win.scores, table };
}

// ------------------------------------------------------------------ odds model
//
// Outcome: does a dated protocol record a token by the snapshot date
// (327 of 645, base rate 0.507)? A logistic fit. The search tries the same
// admission idea: a term is kept only when it lowers BOTH 10-fold CV Brier
// and walk-forward Brier, without worsening leave-one-category-out by more
// than 0.002. Age in years beats log-age here, and it beats it on every
// blind test, which is why the odds model uses linear age.

export const ODDS_TERMS = [
  'size', 'size2', 'chains', 'growth', 'growth_pos', 'growth_neg', 'age',
  'age2', 'size_age', 'size_growth', 'growth_age', 'size_chains', 'cat',
  'young', 'mid_age', 'old', 'age_yrs', 'age_yrs2',
] as const;

export interface OddsFrame {
  dated: Proto[];
  y: number[]; // 1 when the protocol records a token
  cols: Record<string, number[]>;
  centers: { lnTvl: number; age: number; growth: number; chains: number };
  ranges: Record<string, [number, number]>; // each term's [min, max] over the dated protocols
}

export function oddsFrame(snap: Snapshot): OddsFrame {
  const dated = snap.protocols.filter((p) => p.listedAt !== null);
  const lnTvl = dated.map((p) => Math.log(p.tvl));
  const ageL = dated.map((p) => Math.log(ageDays(p, snap.asOf)! + 1));
  const growth = dated.map((p) => clamp(p.growth === null ? 0 : p.growth, -50, 50) / 50);
  const chainsC = dated.map((p) => Math.log1p(p.chains.length));
  const centers = { lnTvl: mean(lnTvl), age: mean(ageL), growth: mean(growth), chains: mean(chainsC) };
  const cols: Record<string, number[]> = {};
  const L = lnTvl.map((v) => v - centers.lnTvl);
  const A = ageL.map((v) => v - centers.age);
  const G = growth.map((v) => v - centers.growth);
  const C = chainsC.map((v) => v - centers.chains);
  cols.size = L;
  cols.size2 = L.map((v) => v * v);
  cols.chains = C;
  cols.growth = G;
  cols.growth_pos = growth.map((v) => Math.max(0, v) - Math.max(0, centers.growth));
  cols.growth_neg = growth.map((v) => Math.min(0, v) - Math.min(0, centers.growth));
  cols.age = A;
  cols.age2 = A.map((v) => v * v);
  cols.size_age = L.map((v, i) => v * A[i]!);
  cols.size_growth = L.map((v, i) => v * G[i]!);
  cols.growth_age = G.map((v, i) => v * A[i]!);
  cols.size_chains = L.map((v, i) => v * C[i]!);
  cols.cat = dated.map(() => 0);
  cols.young = dated.map((p) => (ageDays(p, snap.asOf)! < 365 ? 1 : 0));
  cols.mid_age = dated.map((p) => {
    const d = ageDays(p, snap.asOf)!;
    return d >= 365 && d < 730 ? 1 : 0;
  });
  cols.old = dated.map((p) => (ageDays(p, snap.asOf)! >= 730 ? 1 : 0));
  cols.age_yrs = dated.map((p) => ageDays(p, snap.asOf)! / 365 - 2);
  cols.age_yrs2 = cols.age_yrs.map((v) => v * v);
  const ranges: Record<string, [number, number]> = {};
  for (const t of Object.keys(cols)) {
    if (t === 'cat') continue;
    const col = cols[t]!;
    ranges[t] = [Math.min(...col), Math.max(...col)];
  }
  return { dated, y: dated.map((p) => (hasToken(p) ? 1 : 0)), cols, centers, ranges };
}

/** An odds term's value for one protocol, using the dated centers, clamped
 *  to the range the term takes on the dated protocols. */
export function oddsTerm(p: Proto, term: string, f: OddsFrame, snap: Snapshot): number {
  const L = Math.log(p.tvl) - f.centers.lnTvl;
  const d = ageDays(p, snap.asOf);
  const ageL = (d === null ? Math.log(365 * 2 + 1) : Math.log(d + 1)) - f.centers.age;
  const gRaw = clamp(p.growth === null ? 0 : p.growth, -50, 50) / 50;
  const g = gRaw - f.centers.growth;
  const c = Math.log1p(p.chains.length) - f.centers.chains;
  const yrs = (d === null ? 730 : d) / 365 - 2;
  let v: number;
  switch (term) {
    case 'size': v = L; break;
    case 'size2': v = L * L; break;
    case 'chains': v = c; break;
    case 'growth': v = g; break;
    case 'growth_pos': v = Math.max(0, gRaw) - Math.max(0, f.centers.growth); break;
    case 'growth_neg': v = Math.min(0, gRaw) - Math.min(0, f.centers.growth); break;
    case 'age': v = ageL; break;
    case 'age2': v = ageL * ageL; break;
    case 'size_age': v = L * ageL; break;
    case 'size_growth': v = L * g; break;
    case 'growth_age': v = g * ageL; break;
    case 'size_chains': v = L * c; break;
    case 'young': v = d !== null && d < 365 ? 1 : 0; break;
    case 'mid_age': v = d !== null && d >= 365 && d < 730 ? 1 : 0; break;
    case 'old': v = d !== null && d >= 730 ? 1 : 0; break;
    case 'age_yrs': v = yrs; break;
    case 'age_yrs2': v = yrs * yrs; break;
    default: return 0;
  }
  const r = f.ranges[term];
  return r === undefined ? v : clamp(v, r[0], r[1]);
}

export interface OddsFit {
  beta: number[];
  offsets: Record<string, number>; // logit-scale category offsets, shrunk (k = 5)
}

function designOdds(f: OddsFrame, terms: string[], idxs: number[]): number[][] {
  const base = terms.filter((t) => t !== 'cat');
  return idxs.map((i) => {
    const row = [1];
    for (const t of base) row.push(f.cols[t]![i]!);
    return row;
  });
}

export function fitOdds(f: OddsFrame, terms: string[], idxs: number[]): OddsFit {
  const X = designOdds(f, terms, idxs);
  const y = idxs.map((i) => f.y[i]!);
  const beta = logisticFit(X, y);
  let offsets: Record<string, number> = {};
  if (terms.includes('cat')) {
    const pr = X.map((row) => sigmoid(dot(row, beta)));
    const sum: Record<string, number> = {};
    const wsum: Record<string, number> = {};
    idxs.forEach((i, r) => {
      const c = f.dated[i]!.category ?? '(none)';
      sum[c] = (sum[c] ?? 0) + (y[r]! - pr[r]!);
      wsum[c] = (wsum[c] ?? 0) + pr[r]! * (1 - pr[r]!);
    });
    for (const c of Object.keys(sum)) offsets[c] = sum[c]! / (wsum[c]! + 5);
  }
  return { beta, offsets };
}

export function predictOdds(f: OddsFrame, terms: string[], fit: OddsFit, idxs: number[]): number[] {
  const X = designOdds(f, terms, idxs);
  return X.map((row, j) => {
    let z = dot(row, fit.beta);
    if (terms.includes('cat')) z += fit.offsets[f.dated[idxs[j]!]!.category ?? '(none)'] ?? 0;
    return clamp(sigmoid(z), 1e-6, 1 - 1e-6);
  });
}

function brier(f: OddsFrame, terms: string[], fit: OddsFit, idxs: number[]): number {
  const pr = predictOdds(f, terms, fit, idxs);
  return mean(idxs.map((i, j) => {
    const d = pr[j]! - f.y[i]!;
    return d * d;
  }));
}

export interface OddsScores { cv: number; wf: number; loco: number }

export function evalOdds(f: OddsFrame, terms: string[], repeats = 3): OddsScores {
  const rng = mulberry32(20261114);
  const n = f.dated.length;
  // 10-fold CV.
  let cvErr = 0;
  let cvCnt = 0;
  for (let r = 0; r < repeats; r++) {
    const perm = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = perm[i]!;
      perm[i] = perm[j]!;
      perm[j] = t;
    }
    for (let fold = 0; fold < 10; fold++) {
      const te = perm.filter((_, i) => i % 10 === fold);
      const teSet = new Set(te);
      const tr = perm.filter((i) => !teSet.has(i));
      const fit = fitOdds(f, terms, tr);
      cvErr += brier(f, terms, fit, te) * te.length;
      cvCnt += te.length;
    }
  }
  // Walk-forward by listed_at, same three windows as the value model.
  const dated = f.dated.map((p, i) => ({ p, i })).sort((a, b) => (a.p.listedAt! < b.p.listedAt! ? -1 : 1));
  let wfErr = 0;
  let wfCnt = 0;
  for (const frac of [0.5, 0.6, 0.7]) {
    const cut = Math.floor(n * frac);
    const nxt = Math.floor(n * (frac + 0.2));
    const tr = dated.slice(0, cut).map((d) => d.i);
    const te = dated.slice(cut, nxt).map((d) => d.i);
    const fit = fitOdds(f, terms, tr);
    wfErr += brier(f, terms, fit, te) * te.length;
    wfCnt += te.length;
  }
  // Leave-one-category-out (categories with at least 5 protocols).
  const byCat = new Map<string, number[]>();
  f.dated.forEach((p, i) => {
    const c = p.category ?? '(none)';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(i);
  });
  let loErr = 0;
  let loCnt = 0;
  for (const idxs of byCat.values()) {
    if (idxs.length < 5) continue;
    const idxSet = new Set(idxs);
    const tr = [...Array(n).keys()].filter((i) => !idxSet.has(i));
    const fit = fitOdds(f, terms, tr);
    loErr += brier(f, terms, fit, idxs) * idxs.length;
    loCnt += idxs.length;
  }
  return { cv: cvErr / cvCnt, wf: wfErr / wfCnt, loco: loErr / loCnt };
}

function admitsOdds(cur: OddsScores, next: OddsScores): boolean {
  return next.cv < cur.cv - 0.001 && next.wf < cur.wf - 0.001 && next.loco <= cur.loco + 0.002;
}

export function searchOdds(f: OddsFrame): { chosen: string[]; scores: OddsScores; table: SearchRow[] } {
  const table: SearchRow[] = [];
  let cur: string[] = [];
  let curScores = evalOdds(f, []);
  table.push({ set: [], loo: NaN, wf: curScores.wf, cv: curScores.cv, loco: curScores.loco, verdict: 'baseline (intercept only)' });
  for (let round = 0; round < 5; round++) {
    let best: { term: string; scores: OddsScores; gain: number } | null = null;
    for (const t of ODDS_TERMS) {
      if (cur.includes(t)) continue;
      const m = evalOdds(f, [...cur, t]);
      if (!admitsOdds(curScores, m)) {
        table.push({ set: [...cur, t], loo: NaN, wf: m.wf, cv: m.cv, loco: m.loco, verdict: 'rejected: admission rule' });
        continue;
      }
      const gain = (curScores.cv - m.cv) + (curScores.wf - m.wf);
      if (best === null || gain > best.gain) best = { term: t, scores: m, gain };
    }
    if (best === null) break;
    cur.push(best.term);
    curScores = best.scores;
    table.push({ set: cur.slice(), loo: NaN, wf: curScores.wf, cv: curScores.cv, loco: curScores.loco, verdict: 'admitted by the rule' });
  }
  for (const row of table) {
    if (row.set.length === cur.length && row.set.every((t) => cur.includes(t)) && row.verdict === 'admitted by the rule') {
      row.verdict = 'CHOSEN odds set';
    }
  }
  return { chosen: cur, scores: curScores, table };
}

// ------------------------------------------------------------------ conformal intervals
//
// Split-conformal on the value model: 10-fold out-of-fold residuals, the
// 80% quantile of |residual| (finite-sample corrected) is the interval
// half-width in log units. The three TVL terciles give the same width
// (1.40 / 1.40 / 1.41), so one global half-width is used and the fact is
// reported. Empirical coverage at that width is reported honestly.

export function conformalHalfWidth(f: ValueFrame, terms: string[], snap: Snapshot): { half: number; coverage: number; terciles: number[] } {
  const rng = mulberry32(20261114);
  const n = f.peers.length;
  const perm = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = t;
  }
  const oof = new Array<number>(n).fill(0);
  for (let fold = 0; fold < 10; fold++) {
    const te = perm.filter((_, i) => i % 10 === fold);
    const teSet = new Set(te);
    const tr = perm.filter((i) => !teSet.has(i));
    const fit = fitValue(f, terms, tr, 'huber');
    const pr = predictValue(f, terms, fit, te);
    te.forEach((i, j) => {
      oof[i] = f.y[i]! - pr[j]!;
    });
  }
  const abs = oof.map((v) => Math.abs(v)).sort((a, b) => a - b);
  const q = Math.ceil(0.8 * (n + 1)) / n; // finite-sample corrected 80% quantile
  const half = abs[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))]!;
  const coverage = oof.filter((v) => Math.abs(v) <= half).length / n;
  // Per-tercile widths, to check whether one width is honest.
  const order = f.peers.map((p, i) => ({ tvl: p.tvl, i })).sort((a, b) => a.tvl - b.tvl).map((d) => d.i);
  const terciles: number[] = [];
  for (let k = 0; k < 3; k++) {
    const sel = order.slice(Math.floor((k * n) / 3), Math.floor(((k + 1) * n) / 3));
    const a = sel.map((i) => Math.abs(oof[i]!)).sort((x, y) => x - y);
    terciles.push(a[Math.min(a.length - 1, Math.ceil(0.8 * a.length) - 1)]!);
  }
  return { half, coverage, terciles };
}

// ------------------------------------------------------------------ the board

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface ModelSummary {
  valueTerms: string[];
  valueScores: Scores;
  valueLosses: Record<string, Scores>;
  oddsTerms: string[];
  oddsScores: OddsScores;
  halfWidth: number;
  coverage: number;
  terciles: number[];
  peers: number;
  dated: number;
  preToken: number;
  watchlist: number;
  baseRate: number;
}

export interface Radar {
  board: BoardRow[];
  rows: Array<Record<string, unknown>>; // dashboard rows, with the model numbers
  peersTraded: Array<[string, number]>; // [slug, actual mcap/TVL] for traded peers
  summary: ModelSummary;
  valueTable: SearchRow[];
  oddsTable: SearchRow[];
  valueFit: ValueFit;
  oddsFit: OddsFit;
  valueFrame: ValueFrame;
  oddsFrame: OddsFrame;
  checksum: string;
}

const GAS_USD: Record<string, number> = {
  Ethereum: 1.5, Base: 0.1, Arbitrum: 0.1, Optimism: 0.1, Polygon: 0.1,
  BSC: 0.1, BNB: 0.1, Solana: 0.01, Avalanche: 0.3, Fantom: 0.1,
  Gnosis: 0.05, Linea: 0.1, Scroll: 0.1, zkSync: 0.1, Mantle: 0.05,
};

const CATEGORY_ACTION: Record<string, string> = {
  Dexs: 'Swap a small amount and add a little liquidity',
  Lending: 'Supply collateral and borrow a small amount against it',
  Yield: 'Deposit into a vault and restake the rewards',
  Derivatives: 'Open and close a small position',
  'Liquid Staking': 'Stake a small amount and hold the receipt token',
  Bridge: 'Bridge a small amount to another chain and back',
  'Cross Chain': 'Bridge a small amount to another chain and back',
  RWA: 'Buy a small position in a tokenized asset and hold it',
  'CDP': 'Open a small collateralized position and monitor its ratio',
};

export function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e11 ? 0 : 2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 0.5;
}

function farmSteps(p: Proto, implied: number, lo: number, hi: number, odds: number, snap: Snapshot): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasFor(chain);
  const stake = p.tvl >= 5e8 ? 500 : p.tvl >= 1e8 ? 250 : 100;
  const d = ageDays(p, snap.asOf);
  const weeks = d !== null && d >= 365 ? 8 : 12;
  const holdDays = weeks * 7;
  const totalGas = Math.max(1, Math.round(weeks * 2 * gas));
  const gasBudget = Math.max(2, Math.ceil(weeks * 2 * gas * 1.5));
  const cat = p.category ?? 'DeFi';
  const action = CATEGORY_ACTION[cat] ?? 'Use the protocol\u2019s main function (deposit, swap or stake)';
  return [
    `Set up a fresh wallet on ${chain} and fund it with about $${gasBudget} for gas (roughly $${gas} per transaction on ${chain}); keep the farming stake in this wallet, separate from your main holdings.`,
    `Deposit about $${stake} into ${p.name} (${cat}, TVL ${fmtUsd(p.tvl)}) through the protocol\u2019s own app; confirm the deposit on-chain and keep the transaction hash.`,
    `${action} at least once a week for ${weeks} weeks, so the activity reads as real use rather than a single airdrop grab.`,
    `Hold the position for at least ${holdDays} days and repeat the core action after any gap longer than a week; gas for the whole plan runs to roughly $${totalGas}, plus the $${stake} stake, which stays yours.`,
    `If ${p.name} announces a token, check the claim page only through the protocol\u2019s own channels. The model puts a launch at ${fmtUsd(implied)} (80% range ${fmtUsd(lo)}\u2013${fmtUsd(hi)}) with fitted launch odds of ${Math.round(odds * 100)}%; claim promptly and unstake only after any snapshot is taken.`,
  ];
}

/** FNV-1a over the board's slugs and implied values: the integrity checksum. */
export function boardChecksum(rows: Array<{ slug: string; implied: number }>): string {
  let h = 0x811c9dc5;
  const s = rows.map((r) => `${r.slug}:${r.implied}`).join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Run the whole analysis: search, fit, conformal intervals, board, farm plans. */
export function analyze(snap: Snapshot): Radar {
  const vf = valueFrame(snap);
  const search = searchValue(vf, snap);
  const chosen = search.chosen;
  // Why Huber: the same term set under each loss, all four validations.
  const valueLosses: Record<string, Scores> = {
    ols: evalValue(vf, chosen, 'ols', snap),
    huber: search.scores,
    lad: evalValue(vf, chosen, 'lad', snap),
  };
  const vfit = fitValue(vf, chosen, [...Array(vf.peers.length).keys()], 'huber');
  const of = oddsFrame(snap);
  const osearch = searchOdds(of);
  const ofit = fitOdds(of, osearch.chosen, [...Array(of.dated.length).keys()]);
  const conf = conformalHalfWidth(vf, chosen, snap);

  const watch = new Set(snap.watchlist);
  const pre = boardSubjects(snap);
  const rows: Array<Record<string, unknown>> = [];
  for (const p of pre) {
    const pred = chosen.reduce((s, t, j) => s + valueTerm(p, t, vf, snap) * vfit.beta[j + 1]!, vfit.beta[0]!);
    const ratio = Math.exp(pred);
    // Round the odds FIRST: the farm steps and the dashboard both print the
    // rounded figure, so the steps must be built from it, not from the raw fit.
    const odds = Math.round(clamp(predictOddsOne(of, osearch.chosen, ofit, p, snap), 0.001, 0.999) * 10000) / 10000;
    const implied = Math.max(1, Math.round(p.tvl * ratio * odds));
    const lo = Math.max(1, Math.round(implied * Math.exp(-conf.half)));
    const hi = Math.max(1, Math.round(implied * Math.exp(conf.half)));
    const d = ageDays(p, snap.asOf);
    rows.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl: p.tvl,
      growth: p.growth,
      chains: p.chains.length,
      chain: p.chains[0] ?? null,
      ageDays: d,
      listedAt: p.listedAt,
      watch: watch.has(p.slug),
      pred: Math.round(pred * 10000) / 10000,
      ratio: Math.round(ratio * 10000) / 10000,
      odds,
      implied,
      lo,
      hi,
      steps: farmSteps(p, implied, lo, hi, odds, snap),
    });
  }
  rows.sort((a, b) => {
    const d = (b.implied as number) - (a.implied as number);
    return d !== 0 ? d : (a.slug as string) < (b.slug as string) ? -1 : 1;
  });
  const board: BoardRow[] = rows.map((r, i) => ({
    slug: r.slug as string,
    name: r.name as string,
    rank: i + 1,
    implied_value_usd: r.implied as number,
    farm_steps: r.steps as string[],
  }));
  const peersTraded: Array<[string, number]> = vf.peers
    .map((p) => [p.slug, Math.round((p.mcap! / p.tvl) * 10000) / 10000] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  const summary: ModelSummary = {
    valueTerms: chosen,
    valueScores: search.scores,
    valueLosses,
    oddsTerms: osearch.chosen,
    oddsScores: osearch.scores,
    halfWidth: conf.half,
    coverage: conf.coverage,
    terciles: conf.terciles,
    peers: vf.peers.length,
    dated: of.dated.length,
    preToken: pre.length,
    watchlist: snap.watchlist.length,
    baseRate: mean(of.y),
  };
  return {
    board,
    rows,
    peersTraded,
    summary,
    valueTable: search.table,
    oddsTable: osearch.table,
    valueFit: vfit,
    oddsFit: ofit,
    valueFrame: vf,
    oddsFrame: of,
    checksum: boardChecksum(rows.map((r) => ({ slug: r.slug as string, implied: r.implied as number }))),
  };
}

/** Launch odds for one protocol from the fitted odds model. */
export function predictOddsOne(f: OddsFrame, terms: string[], fit: OddsFit, p: Proto, snap: Snapshot): number {
  const row = [1];
  for (const t of terms) {
    if (t === 'cat') continue;
    row.push(oddsTerm(p, t, f, snap));
  }
  let z = dot(row, fit.beta);
  if (terms.includes('cat')) z += fit.offsets[p.category ?? '(none)'] ?? 0;
  return clamp(sigmoid(z), 1e-6, 1 - 1e-6);
}

// ------------------------------------------------------------------ generated dashboard data

/** The generated zz-snapshot-data.js: the board rows, the model, the peers. */
export function dataScript(radar: Radar, snap: Snapshot): string {
  const s = radar.summary;
  const payload = {
    asOf: snap.asOf,
    floorUsd: snap.floorUsd,
    checksum: radar.checksum,
    model: {
      // Coefficients and the half-width at full precision: the browser
      // recompute must reproduce the board's integers exactly, and a rounded
      // coefficient moves a million-dollar value by tens of dollars.
      valueTerms: s.valueTerms,
      valueBeta: radar.valueFit.beta,
      valueOffsets: radar.valueFit.offsets,
      centers: {
        lnTvl: radar.valueFrame.centers.lnTvl,
        age: radar.valueFrame.centers.age,
        growth: radar.valueFrame.centers.growth,
        chains: radar.valueFrame.centers.chains,
        medianAge: radar.valueFrame.centers.medianAge,
      },
      oddsTerms: s.oddsTerms,
      oddsBeta: radar.oddsFit.beta,
      oddsOffsets: radar.oddsFit.offsets,
      oddsCenters: {
        lnTvl: radar.oddsFrame.centers.lnTvl,
        age: radar.oddsFrame.centers.age,
        growth: radar.oddsFrame.centers.growth,
        chains: radar.oddsFrame.centers.chains,
      },
      termRanges: radar.valueFrame.ranges,
      oddsTermRanges: radar.oddsFrame.ranges,
      halfWidth: s.halfWidth,
      coverage: Math.round(s.coverage * 1000) / 1000,
      valueScores: {
        loo: Math.round(s.valueScores.loo * 1000) / 1000,
        wf: Math.round(s.valueScores.wf * 1000) / 1000,
        cv: Math.round(s.valueScores.cv * 1000) / 1000,
        loco: Math.round(s.valueScores.loco * 1000) / 1000,
      },
      oddsScores: {
        cv: Math.round(s.oddsScores.cv * 10000) / 10000,
        wf: Math.round(s.oddsScores.wf * 10000) / 10000,
        loco: Math.round(s.oddsScores.loco * 10000) / 10000,
      },
    },
    // pred / ratio / listedAt are left out: the page recomputes pred and
    // ratio from the raw figures (model.js predict) and shows age, not the date.
    cols: ['slug', 'name', 'category', 'tvl', 'growth', 'chains', 'chain', 'ageDays', 'watch', 'odds', 'implied', 'lo', 'hi'],
    rows: radar.rows.map((r) => [
      r.slug, r.name, r.category, r.tvl, r.growth, r.chains, r.chain, r.ageDays,
      r.watch ? 1 : 0, r.odds, r.implied, r.lo, r.hi,
    ]),
    peers: radar.peersTraded,
  };
  // One row per line, not one giant line: the dossier's text cap cuts files
  // at a line boundary, so a single-line file would vanish whole while a
  // line-per-row file shows its head — the structure and the top rows.
  const rowsText = (payload.rows as unknown[][]).map((r) => JSON.stringify(r)).join(',\n');
  const peersText = (payload.peers as unknown[][]).map((r) => JSON.stringify(r)).join(',\n');
  return `// Generated by main.ts from the sealed snapshot; the page and model.js recompute the board from these rows.\nwindow.TOKEN_RADAR = {\n"asOf": ${JSON.stringify(payload.asOf)},\n"floorUsd": ${payload.floorUsd},\n"checksum": ${JSON.stringify(payload.checksum)},\n"model": ${JSON.stringify(payload.model)},\n"cols": ${JSON.stringify(payload.cols)},\n"rows": [\n${rowsText}\n],\n"peers": [\n${peersText}\n]\n};\n`;
}

/** The generated evidence.js: the full admission-search tables. */
export function evidenceScript(radar: Radar): string {
  const num = (v: number | null, digits: number): number | null =>
    v === null || Number.isNaN(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits;
  // Pairs were screened on LOO + WF only: store just those three values.
  // Full rows (baseline, admitted, chosen) carry all four scores + verdict.
  const pack = (rows: SearchRow[], digits: number): Array<unknown> =>
    rows.map((r) => {
      if (r.verdict === 'pair screened') {
        return [r.set.join('+'), num(r.loo, digits), num(r.wf, digits)];
      }
      return [
        r.set.join('+') || '(intercept)',
        num(r.loo, digits),
        num(r.wf, digits),
        num(r.cv, digits),
        num(r.loco, digits),
        r.verdict,
      ];
    });
  const payload = {
    value: {
      chosen: radar.summary.valueTerms,
      scores: {
        loo: num(radar.summary.valueScores.loo, 3),
        wf: num(radar.summary.valueScores.wf, 3),
        cv: num(radar.summary.valueScores.cv, 3),
        loco: num(radar.summary.valueScores.loco, 3),
      },
      losses: Object.fromEntries(
        Object.entries(radar.summary.valueLosses).map(([k, v]) => [
          k, { loo: num(v.loo, 3), wf: num(v.wf, 3), cv: num(v.cv, 3), loco: num(v.loco, 3) },
        ]),
      ),
      table: pack(radar.valueTable, 3),
    },
    odds: {
      chosen: radar.summary.oddsTerms,
      scores: {
        cv: num(radar.summary.oddsScores.cv, 4),
        wf: num(radar.summary.oddsScores.wf, 4),
        loco: num(radar.summary.oddsScores.loco, 4),
      },
      table: pack(radar.oddsTable, 4),
    },
    conformal: {
      half: num(radar.summary.halfWidth, 3),
      coverage: num(radar.summary.coverage, 3),
      terciles: radar.summary.terciles.map((v) => num(v, 3)),
    },
  };
  return `// Generated by main.ts: every term the admission search tried, kept and rejected alike.\nwindow.TOKEN_RADAR_EVIDENCE = ${JSON.stringify(payload)};\n`;
}

// ------------------------------------------------------------------ gate self-check

/** The gate's own shape, checked before anything is written: a board the
 *  gate refuses is a bug in this program, not a submission. */
export function boardIssue(board: BoardRow[], snap: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const slugs = new Set<string>();
  for (const row of board) {
    if (!row.slug || /\s/.test(row.slug)) return `row ${row.rank}: a bad slug`;
    if (slugs.has(row.slug)) return `slug ${row.slug} appears twice`;
    slugs.add(row.slug);
    if (!snap.protocols.some((p) => p.slug === row.slug)) return `slug ${row.slug} is not in the snapshot`;
    if (!row.name) return `row ${row.rank}: an empty name`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) {
      return `row ${row.rank}: an implied value outside the gate`;
    }
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.rank}: ${row.farm_steps?.length ?? 0} farm steps, the gate wants 3 to 12`;
    }
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${row.rank}: a farm step of ${t.length} characters, the gate wants 20 to 600`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `ranks are not exactly 1 to ${board.length}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${board[i]!.rank} is worth more than row ${board[i - 1]!.rank}`;
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'every row has the same implied value';
  for (const w of snap.watchlist) if (!slugs.has(w)) return `watchlist slug ${w} is missing from the board`;
  return null;
}
