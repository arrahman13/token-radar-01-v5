# Token Radar v5 — Launch Radar

[![Competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/arrahman13/token-radar-01-v5/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/arrahman13/token-radar-01-v5/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token launch radar over the sealed DefiLlama snapshot of 758 protocols.
It ranks 178 protocols that record no token by an implied value — TVL × a
fitted value multiple × fitted launch odds — and gives every one a costed
farm plan. Entry for the make.fun bounty
[token-radar-01](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01).

## The models, and how they are kept honest

- **Value model.** A Huber (robust) regression of ln(market cap / TVL) on the
  87 traded peers with a market cap of at least $5M. Terms, chosen by the
  admission search, not by hand: `size` (ln TVL), `size3` (its cube),
  `growth_age` (7-day growth × age) and `size_growth` (ln TVL × growth).
  Scores, as factors (exp of mean |log error|): **leave-one-out ×2.783,
  walk-forward ×2.363, 10-fold CV ×2.792, leave-one-category-out ×2.690**.
  On the same term set, least squares gives ×2.925 / ×2.548 and median (L1)
  regression gives ×2.637 / ×2.454 — Huber is used because it wins
  walk-forward and its walk-forward is the most stable across the sets the
  search tried (×2.36–2.52, against ×2.31–3.03 for median regression).
- **Odds model.** A logistic fit on the 645 dated protocols (327 record a
  token by the snapshot date, base rate 0.507): age in years plus shrunk
  category offsets. Brier **0.2018 (10-fold CV) / 0.2256 (walk-forward) /
  0.2222 (leave-one-category-out)**. Linear age beat log-age on every blind
  test, so the odds use linear age.
- **Admission search.** Every candidate term is tried as a single, as part of
  every pair (136 pairs), then a greedy forward search grows each of the top
  7 pairs. A term is kept only if it lowers **both** blind tests —
  leave-one-out and walk-forward for value, 10-fold CV and walk-forward for
  odds — without worsening the guards (10-fold CV / leave-one-category-out).
  The dashboard's evidence rail lists every single and pair, each greedy
  round with how many candidates the rule rejected, and the loss comparison.
- **The board's subjects.** The 40 watchlist protocols plus every pre-token
  protocol below the $50M floor that passes the watchlist's own exclusion
  test (no Bridge / CEX / liquid-staking category, no versioned or
  wrapped/staked name, no exchange-prefixed name). Above the floor the
  house's watchlist is the authority — it also checks the parent protocol, a
  field the snapshot does not carry — so the 20 above-floor protocols it
  leaves out are left out here too. Without the test the top of the board
  would be exchanges and bridges (Bybit, HTX, WBTC): large, but not token
  launches to farm. (v4's 198 rows are exactly the count of pre-token
  protocols passing the replicated test, which includes those 20.) Top of
  the board: Anemoy Capital $88.02M, Flowdesk $63.43M, Steakhouse
  Financial $58.09M.
- **Range honesty.** Every term is clamped to the range it takes on the
  protocols the model was fitted on, so no implied value comes from
  extrapolating an interaction beyond what any traded peer showed. (Without
  the clamp, the top row's growth×age interaction ran 2× past the peers'
  range and its implied value was $737M; with it, $63M.)
- **Conformal intervals.** The 80% interval is split-conformal: the 80%
  quantile of 10-fold out-of-fold residuals, **±1.446 log units (a factor of
  ×4.25 either way), empirical coverage 0.82**. Per-TVL-tercile widths
  1.54 / 1.65 / 1.43 are close enough that one global width is used — and
  reported honestly, because launch values genuinely vary that much.
- **Integrity by recompute.** The dashboard embeds the snapshot rows and the
  same model code (`dashboard/model.js`), rebuilds the board in the browser,
  and prints the match beside the checksum. On this snapshot: **178/178 rows
  match exactly, checksum `568fa387`**, and the browser's farm steps agree
  with `board.json` on **178/178 rows**.

## Against the targets

| | Target | v5 (this entry) | v4 (live entry) |
|---|---|---|---|
| Value leave-one-out | better than ×2.99 | **×2.783** | ×3.07 |
| Value walk-forward | below ×2.53 | **×2.363** | ×2.84 |
| Value 10-fold CV | — | ×2.792 | — |
| Odds Brier CV / WF | — | 0.2018 / 0.2256 | 0.201 / 0.218 |
| Judge rate | above 96.68% | not measurable locally — no local grade exists for this competition | 94.97% |

The walk-forward figure is an expanding-window mean over three cutoffs
(50/60/70% of dated peers, scoring the next 20%); the leaders' published
walk-forward numbers (e.g. kevin's ×2.26) use an unknown definition, so no
comparability with them is claimed — only that this entry's own measured
walk-forward beats the ×2.53 bar on its stated definition.

## Run it

```
mkdir -p /input /output   # or point --input / MAKEFUN_OUTPUT_DIR elsewhere
node main.ts              # reads /input/snapshot.json, writes /output
```

Node 22.18+, standard library only. The program runs twice and writes the
same bytes (verified: two runs, byte-identical): `board.json`,
`dashboard/` (with the generated `zz-snapshot-data.js` and `evidence.js`),
`screenshots/`, and `dossier.json` built with the kit's
`vendor/makefun-board.ts`. One run takes ~31–33 s on this machine, inside
the 120 s limit. The dossier's text leaves out only the last 5,426 bytes of
the data file (the cut line says so); every code file is shown whole.

## Layout

- `main.ts` — entrypoint: analysis, outputs, dossier (with a byte-for-byte
  dossier self-check before it reports success).
- `lib/model.ts` — the whole model: data prep, both fits, the admission
  search, conformal intervals, farm economics, the board. Written fresh for
  this entry; the search runs at grade time, so the board is derived, not
  pasted.
- `dashboard/` — the page: board, evidence rail, per-protocol detail,
  filters, sorting, traded-peers table, method. `model.js` recomputes the
  board in the browser; `farmSteps` in `model.js` is the same template set
  as `lib/model.ts`, so the page's farm plans and `board.json` agree.
- `screenshots/` — the board, a protocol detail view (Anemoy Capital), a
  filtered view (Dexs), each 1440×900.
- `vendor/makefun-board.ts` — the kit's dossier library, copied byte for
  byte (the scorer's own copy).
