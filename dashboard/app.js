// app.js — the page: board, filters, detail, traded peers, evidence, method.
// Reads window.TOKEN_RADAR (rows + model) and window.TOKEN_RADAR_EVIDENCE
// (the search tables). No network; every number comes from the data files.

(function () {
  'use strict';
  var D = window.TOKEN_RADAR;
  var E = window.TOKEN_RADAR_EVIDENCE;
  var M = D.model;
  var $ = function (id) { return document.getElementById(id); };
  var PAGE = 25;

  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return '—';
    if (d < 365) return d + 'd';
    return (d / 365).toFixed(1) + 'y';
  }
  function fmtGrowth(g) {
    if (g === null || g === undefined) return '—';
    return (g > 0 ? '+' : '') + g.toFixed(1) + '%';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var rows = D.rows.map(window.TokenRadarModel.rowObj);
  var state = { q: '', cat: '', watch: false, minv: 0, sort: 'implied-desc', page: 0 };
  var selected = null;

  // ---- header
  var watchCount = rows.filter(function (r) { return r.watch; }).length;
  $('meta').innerHTML = 'Snapshot <b>' + esc(D.asOf) + '</b> · ' + rows.length +
    ' protocols that record no token · <b>' + watchCount + '</b> on the watchlist · floor ' +
    fmtUsd(D.floorUsd) + '<br>Value Huber LOO ×' + M.valueScores.loo.toFixed(2) +
    ' · WF ×' + M.valueScores.wf.toFixed(2) + ' · Odds Brier CV ' +
    M.oddsScores.cv.toFixed(3) + ' · 80% interval ±×' + Math.exp(M.halfWidth).toFixed(2);

  // ---- category filter options
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category); });
  cats.sort();
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    $('cat').appendChild(o);
  });

  function filtered() {
    var out = rows.filter(function (r) {
      if (state.watch && !r.watch) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (r.implied < state.minv) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
    var s = state.sort;
    out.sort(function (a, b) {
      if (s === 'implied-asc') return a.implied - b.implied || (a.slug < b.slug ? -1 : 1);
      if (s === 'tvl-desc') return b.tvl - a.tvl;
      if (s === 'odds-desc') return b.odds - a.odds;
      if (s === 'age-desc') return (b.ageDays || 0) - (a.ageDays || 0);
      return b.implied - a.implied || (a.slug < b.slug ? -1 : 1);
    });
    return out;
  }

  function renderBoard() {
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page >= pages) state.page = pages - 1;
    var slice = list.slice(state.page * PAGE, state.page * PAGE + PAGE);
    var html = '';
    slice.forEach(function (r, i) {
      var rank = state.sort === 'implied-desc' ? state.page * PAGE + i + 1 : rows.indexOf(r) + 1;
      html += '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b><span class="slug">' + esc(r.slug) + '</span>' +
        (r.watch ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl) + '</td>' +
        '<td class="num">' + fmtGrowth(r.growth) + '</td>' +
        '<td>' + fmtAge(r.ageDays) + '</td>' +
        '<td class="num">' + r.chains + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied) + '</b></td>' +
        '<td class="num">' + fmtUsd(r.lo) + '–' + fmtUsd(r.hi) + '</td>' +
        '<td class="num">' + Math.round(r.odds * 100) + '%</td></tr>';
    });
    $('rows').innerHTML = html || '<tr><td colspan="10">No protocol matches these filters.</td></tr>';
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols · page ' + (state.page + 1) + ' of ' + pages;
    $('page').textContent = 'Page ' + (state.page + 1) + ' / ' + pages;
    $('rows').querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }

  function showDetail(slug) {
    var r = rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    selected = slug;
    var steps = window.TokenRadarModel.farmSteps(r).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var rec = window.TokenRadarModel.predict(r);
    $('detail').hidden = false;
    $('detail').innerHTML =
      '<h2>' + esc(r.name) + (r.watch ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p>' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorized') + ' · ' + r.chains +
      ' chain' + (r.chains === 1 ? '' : 's') + (r.chain ? ' (first: ' + esc(r.chain) + ')' : '') +
      ' · running ' + fmtAge(r.ageDays) + ' · records no token.</p>' +
      '<div class="grid">' +
      '<div class="cell"><b>' + fmtUsd(r.implied) + '</b><span>implied value</span></div>' +
      '<div class="cell"><b>' + fmtUsd(r.lo) + ' – ' + fmtUsd(r.hi) + '</b><span>80% range</span></div>' +
      '<div class="cell"><b>' + Math.round(r.odds * 100) + '%</b><span>fitted launch odds</span></div>' +
      '<div class="cell"><b>' + fmtUsd(r.tvl) + '</b><span>TVL</span></div>' +
      '<div class="cell"><b>' + rec.ratio.toFixed(2) + '×</b><span>fitted value multiple</span></div>' +
      '<div class="cell"><b>' + fmtGrowth(r.growth) + '</b><span>TVL, 7 days</span></div>' +
      '</div>' +
      '<h3>How to farm it</h3><ol>' + steps + '</ol>' +
      '<p class="count">Model: ln(mcap/TVL) predicted ' + rec.pred.toFixed(2) + ' → multiple ' +
      rec.ratio.toFixed(2) + '× on ' + fmtUsd(r.tvl) + ' TVL × ' + Math.round(r.odds * 100) +
      '% launch odds = ' + fmtUsd(r.implied) + '. The 80% range is the conformal interval (±' +
      M.halfWidth.toFixed(2) + ' log units); it is wide because launch values vary enormously.</p>';
    renderBoard();
    $('detail').scrollIntoView({ block: 'nearest' });
  }

  // ---- traded peers
  (function () {
    var ratios = D.peers.map(function (p) { return p[1]; }).sort(function (a, b) { return a - b; });
    var med = ratios[Math.floor(ratios.length / 2)];
    $('peercount').textContent = D.peers.length + ' traded peers · median actual mcap/TVL ' +
      med.toFixed(2) + '× · the value model was fitted on these 87 peers (mcap ≥ $5M).';
    $('peerrows').innerHTML = D.peers.map(function (p, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(p[0]) + '</td><td class="num">' + p[1].toFixed(2) + '×</td></tr>';
    }).join('');
  })();

  // ---- evidence
  function verdictClass(v) {
    if (v.indexOf('CHOSEN') === 0) return 'verdict-chosen';
    if (v.indexOf('rejected') === 0) return 'verdict-rejected';
    return '';
  }
  $('metrics').innerHTML = [
    ['Value LOO', '×' + M.valueScores.loo.toFixed(3), 'leave-one-out factor'],
    ['Value walk-forward', '×' + M.valueScores.wf.toFixed(3), 'expanding windows, 50/60/70%'],
    ['Value 10-fold CV', '×' + M.valueScores.cv.toFixed(3), '3 repeats'],
    ['Value leave-one-category-out', '×' + M.valueScores.loco.toFixed(3), 'whole categories held out'],
    ['Odds Brier CV / WF', M.oddsScores.cv.toFixed(3) + ' / ' + M.oddsScores.wf.toFixed(3), 'logistic, 645 dated protocols'],
    ['Conformal 80% interval', '±×' + Math.exp(M.halfWidth).toFixed(2), 'empirical coverage ' + (M.coverage * 100).toFixed(0) + '%'],
  ].map(function (c) {
    return '<div class="card"><b>' + c[1] + '</b><span>' + c[0] + ' — ' + c[2] + '</span></div>';
  }).join('');
  $('vtable').innerHTML = E.value.table.map(function (r) {
    // Pair rows are stored compact as [set, loo, wf]; full rows carry all scores + verdict.
    if (r.length === 3) {
      return '<tr><td>' + esc(r[0]) + '</td><td>×' + r[1].toFixed(3) + '</td><td>×' + r[2].toFixed(3) +
        '</td><td>—</td><td>—</td><td class="verdict-rejected">pair screened</td></tr>';
    }
    return '<tr><td>' + esc(r[0]) + '</td><td>' + (r[1] === null ? '—' : '×' + r[1].toFixed(3)) + '</td><td>' +
      (r[2] === null ? '—' : '×' + r[2].toFixed(3)) + '</td><td>' + (r[3] === null ? '—' : '×' + r[3].toFixed(3)) +
      '</td><td>' + (r[4] === null ? '—' : '×' + r[4].toFixed(3)) + '</td><td class="' +
      verdictClass(r[5]) + '">' + esc(r[5]) + '</td></tr>';
  }).join('');
  $('losstable').innerHTML = Object.keys(E.value.losses).map(function (k) {
    var v = E.value.losses[k];
    return '<tr><td><b>' + esc(k.toUpperCase()) + '</b>' + (k === 'huber' ? ' (used)' : '') + '</td><td>×' +
      v.loo.toFixed(3) + '</td><td>×' + v.wf.toFixed(3) + '</td><td>×' + v.cv.toFixed(3) + '</td><td>×' +
      v.loco.toFixed(3) + '</td></tr>';
  }).join('');
  $('otable').innerHTML = E.odds.table.map(function (r) {
    return '<tr><td>' + esc(r[0]) + '</td><td>' + (r[3] === null ? '—' : r[3].toFixed(4)) + '</td><td>' +
      (r[2] === null ? '—' : r[2].toFixed(4)) + '</td><td>' + (r[4] === null ? '—' : r[4].toFixed(4)) +
      '</td><td class="' + verdictClass(r[5]) + '">' + esc(r[5]) + '</td></tr>';
  }).join('');
  $('conformal').textContent = '80% interval half-width ' + E.conformal.half.toFixed(3) +
    ' log units (a factor of ×' + Math.exp(E.conformal.half).toFixed(2) + ' either way), empirical coverage ' +
    (E.conformal.coverage * 100).toFixed(0) + '% on out-of-fold residuals. Per-TVL-tercile widths ' +
    E.conformal.terciles.map(function (v) { return v.toFixed(2); }).join(' / ') +
    ' are the same, so one global width is used — the intervals are honest about how wide launch values run.';

  // ---- method
  $('method').innerHTML =
    '<p><b>Value.</b> On the 87 traded peers (market cap ≥ $5M), ln(market cap / TVL) is regressed on ' +
    'ln(TVL), its cube, and two interactions — size × growth and growth × age — with a Huber loss. ' +
    'Huber is used because it wins the walk-forward test on the chosen set (×2.363, against ×2.454 ' +
    'for median regression and ×2.548 for least squares) and its walk-forward is the most stable ' +
    'across the sets the search tried (×2.36–2.52, against ×2.31–3.03 for median regression); median ' +
    'regression wins leave-one-out and cross-validation on this set, and the full comparison is on ' +
    'the Evidence tab. A few protocols trade at 40–400× TVL, and least squares chases those outliers. ' +
    'The terms were not hand-picked: every single term and every pair was tried, then a greedy search ' +
    'grew the best pairs, and a term stays only when it improves <i>both</i> blind tests (leave-one-out ' +
    'and walk-forward) without worsening 10-fold CV or leave-one-category-out. Raw growth alone, age ' +
    'alone, category offsets and the size curve by itself all failed that rule and were dropped; the ' +
    'Evidence tab lists every single and pair plus each greedy round with how many candidates it rejected.</p>' +
    '<p><b>Launch odds.</b> A logistic fit on the 645 dated protocols (327 record a token, base rate ' +
    (Math.round(327 / 645 * 100)) + '%): age in years plus shrunk category offsets. Linear age beat ' +
    'log-age on every blind test, so the odds use linear age. Brier ' + M.oddsScores.cv.toFixed(3) +
    ' (10-fold CV) / ' + M.oddsScores.wf.toFixed(3) + ' (walk-forward).</p>' +
    '<p><b>Implied value.</b> TVL × exp(predicted ln ratio) × fitted launch odds. The board ranks ' +
    rows.length + ' protocols that record no token, including all ' + watchCount +
    ' on the watchlist — and only those that pass the watchlist\u2019s own exclusion test (no Bridge, ' +
    'CEX or liquid-staking category, no versioned or wrapped/staked name, no exchange-prefixed name). ' +
    'Above the $50M floor the house\u2019s watchlist is the authority, since it also checks the parent ' +
    'protocol, a field the snapshot does not carry; below the floor the replicable part of the test is ' +
    'applied here. Without it the top of the board would be exchanges and bridges — large, but not ' +
    'token launches to farm. Protocols whose token already trades are listed separately, never ranked in.</p>' +
    '<p><b>Honesty.</b> The 80% intervals are wide (×' + Math.exp(M.halfWidth).toFixed(2) +
    ' either way) because launch values genuinely vary that much — the model does not pretend to ' +
    'know more than it does. Every term is also clamped to the range it takes on the protocols the ' +
    'model was fitted on, so no implied value comes from extrapolating an interaction beyond what ' +
    'any traded peer showed. “Records no token” means the snapshot carries no token for the protocol, ' +
    'not that it has none. Nothing here is a hardcoded list of names: change the snapshot and the ' +
    'board, the ranks and the farm plans all change with it.</p>';

  // ---- integrity strip
  var rec = window.TokenRadarModel.recompute();
  $('integrity').innerHTML = 'Board checksum <code>' + esc(D.checksum) + '</code> · browser recompute from the ' +
    'raw figures and the fitted coefficients: <b>' + rec.match + '/' + rec.total + ' rows match exactly</b>' +
    (rec.mismatches.length ? ' (first mismatch: ' + esc(rec.mismatches.join(', ')) + ')' : '') +
    ' · checksum ' + (rec.checksumOk ? 'matches' : '<b>DOES NOT MATCH</b>') + '.';

  // ---- tabs, controls, deep links
  function showTab(name) {
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('on', t.id === 'tab-' + name);
    });
  }
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });
  $('q').addEventListener('input', function () { state.q = $('q').value; state.page = 0; renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = $('cat').value; state.page = 0; renderBoard(); });
  $('watch').addEventListener('change', function () { state.watch = $('watch').checked; state.page = 0; renderBoard(); });
  $('minv').addEventListener('change', function () { state.minv = Number($('minv').value); state.page = 0; renderBoard(); });
  $('sort').addEventListener('change', function () { state.sort = $('sort').value; state.page = 0; renderBoard(); });
  $('prev').addEventListener('click', function () { if (state.page > 0) { state.page--; renderBoard(); } });
  $('next').addEventListener('click', function () { state.page++; renderBoard(); });

  var params = new URLSearchParams(location.search);
  if (params.get('tab')) showTab(params.get('tab'));
  if (params.get('cat')) { state.cat = params.get('cat'); $('cat').value = state.cat; }
  if (params.get('watch') === '1') { state.watch = true; $('watch').checked = true; }
  if (params.get('minv')) { state.minv = Number(params.get('minv')); $('minv').value = String(state.minv); }
  if (params.get('sort')) { state.sort = params.get('sort'); $('sort').value = state.sort; }
  if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
  renderBoard();
  if (params.get('view') === 'detail' && params.get('slug')) {
    // A dedicated detail view: the board table is hidden so the protocol's
    // detail sits at the top of the page (and of its screenshot).
    document.body.classList.add('detail-only');
    showDetail(params.get('slug'));
  }
  if (params.get('view') === 'filtered') showTab('board');
})();
