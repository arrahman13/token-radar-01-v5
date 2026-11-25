// model.js — the same model as lib/model.ts, running in the browser.
//
// The page embeds the snapshot rows and the fitted coefficients in
// zz-snapshot-data.js; this file recomputes every row's implied value from
// the raw figures and checks it against the embedded one. If the board and
// the code disagree, the integrity strip says so. No network, no names
// hardcoded: every term is a function of TVL, growth, age and chains.

(function () {
  'use strict';
  var D = window.TOKEN_RADAR;
  var M = D.model;

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function sigmoid(z) {
    if (z >= 0) { var e = Math.exp(-z); return 1 / (1 + e); }
    var e2 = Math.exp(z); return e2 / (1 + e2);
  }

  // One row of the data file, as [slug,name,category,tvl,growth,chains,chain,
  // ageDays,watch,odds,implied,lo,hi]. pred and ratio are recomputed by
  // predict(), never trusted from the file.
  function rowObj(r) {
    return { slug: r[0], name: r[1], category: r[2], tvl: r[3], growth: r[4],
      chains: r[5], chain: r[6], ageDays: r[7], watch: r[8],
      odds: r[9], implied: r[10], lo: r[11], hi: r[12] };
  }

  // ---- farm plans, generated from the row's own figures.
  // The same templates as lib/model.ts farmSteps: the board's farm_steps and
  // the page's are built by the same rules, so they agree by construction.
  var GAS_USD = { Ethereum: 1.5, Base: 0.1, Arbitrum: 0.1, Optimism: 0.1,
    Polygon: 0.1, BSC: 0.1, BNB: 0.1, Solana: 0.01, Avalanche: 0.3,
    Fantom: 0.1, Gnosis: 0.05, Linea: 0.1, Scroll: 0.1, zkSync: 0.1, Mantle: 0.05 };
  var CATEGORY_ACTION = {
    Dexs: 'Swap a small amount and add a little liquidity',
    Lending: 'Supply collateral and borrow a small amount against it',
    Yield: 'Deposit into a vault and restake the rewards',
    Derivatives: 'Open and close a small position',
    'Liquid Staking': 'Stake a small amount and hold the receipt token',
    Bridge: 'Bridge a small amount to another chain and back',
    'Cross Chain': 'Bridge a small amount to another chain and back',
    RWA: 'Buy a small position in a tokenized asset and hold it',
    CDP: 'Open a small collateralized position and monitor its ratio' };
  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
    return '$' + Math.round(n);
  }
  function farmSteps(p) {
    var chain = p.chain || 'Ethereum';
    var gas = GAS_USD[chain] === undefined ? 0.5 : GAS_USD[chain];
    var stake = p.tvl >= 5e8 ? 500 : p.tvl >= 1e8 ? 250 : 100;
    var weeks = p.ageDays !== null && p.ageDays >= 365 ? 8 : 12;
    var holdDays = weeks * 7;
    var totalGas = Math.max(1, Math.round(weeks * 2 * gas));
    var gasBudget = Math.max(2, Math.ceil(weeks * 2 * gas * 1.5));
    var cat = p.category || 'DeFi';
    var action = CATEGORY_ACTION[cat] || 'Use the protocol\u2019s main function (deposit, swap or stake)';
    return [
      'Set up a fresh wallet on ' + chain + ' and fund it with about $' + gasBudget +
        ' for gas (roughly $' + gas + ' per transaction on ' + chain +
        '); keep the farming stake in this wallet, separate from your main holdings.',
      'Deposit about $' + stake + ' into ' + p.name + ' (' + cat + ', TVL ' + fmtUsd(p.tvl) +
        ') through the protocol\u2019s own app; confirm the deposit on-chain and keep the transaction hash.',
      action + ' at least once a week for ' + weeks +
        ' weeks, so the activity reads as real use rather than a single airdrop grab.',
      'Hold the position for at least ' + holdDays +
        ' days and repeat the core action after any gap longer than a week; gas for the whole plan runs to roughly $' +
        totalGas + ', plus the $' + stake + ' stake, which stays yours.',
      'If ' + p.name + ' announces a token, check the claim page only through the protocol\u2019s own channels. The model puts a launch at ' +
        fmtUsd(p.implied) + ' (80% range ' + fmtUsd(p.lo) + '\u2013' + fmtUsd(p.hi) +
        ') with fitted launch odds of ' + Math.round(p.odds * 100) +
        '%; claim promptly and unstake only after any snapshot is taken.'
    ];
  }

  // A value term for one protocol, mirroring lib/model.ts valueTerm exactly,
  // including the clamp to the range the term takes on the peers.
  function valueTerm(p, term) {
    var c = M.centers;
    var L = Math.log(p.tvl) - c.lnTvl;
    var age = ((p.ageDays === null ? c.medianAge : Math.log(p.ageDays + 1)) - c.age);
    var gRaw = clamp(p.growth === null ? 0 : p.growth, -50, 50) / 50;
    var g = gRaw - c.growth;
    var ch = Math.log1p(p.chains) - c.chains;
    var v;
    switch (term) {
      case 'size': v = L; break;
      case 'size2': v = L * L; break;
      case 'size3': v = L * L * L; break;
      case 'chains': v = ch; break;
      case 'chains_raw': v = p.chains / 10; break;
      case 'chains2': v = ch * ch; break;
      case 'growth': v = g; break;
      case 'growth_pos': v = Math.max(0, gRaw) - Math.max(0, c.growth); break;
      case 'growth_neg': v = Math.min(0, gRaw) - Math.min(0, c.growth); break;
      case 'age': v = age; break;
      case 'age_miss': v = p.ageDays === null ? 1 : 0; break;
      case 'age2': v = age * age; break;
      case 'size_age': v = L * age; break;
      case 'size_growth': v = L * g; break;
      case 'growth_age': v = g * age; break;
      case 'size_chains': v = L * ch; break;
      default: return 0;
    }
    var r = M.termRanges[term];
    return r === undefined ? v : clamp(v, r[0], r[1]);
  }

  // An odds term for one protocol, mirroring lib/model.ts oddsTerm exactly,
  // including the clamp to the range the term takes on the dated protocols.
  function oddsTerm(p, term) {
    var c = M.oddsCenters;
    var L = Math.log(p.tvl) - c.lnTvl;
    var d = p.ageDays;
    var ageL = ((d === null ? Math.log(365 * 2 + 1) : Math.log(d + 1)) - c.age);
    var gRaw = clamp(p.growth === null ? 0 : p.growth, -50, 50) / 50;
    var g = gRaw - c.growth;
    var ch = Math.log1p(p.chains) - c.chains;
    var yrs = (d === null ? 730 : d) / 365 - 2;
    var v;
    switch (term) {
      case 'size': v = L; break;
      case 'size2': v = L * L; break;
      case 'chains': v = ch; break;
      case 'growth': v = g; break;
      case 'growth_pos': v = Math.max(0, gRaw) - Math.max(0, c.growth); break;
      case 'growth_neg': v = Math.min(0, gRaw) - Math.min(0, c.growth); break;
      case 'age': v = ageL; break;
      case 'age2': v = ageL * ageL; break;
      case 'size_age': v = L * ageL; break;
      case 'size_growth': v = L * g; break;
      case 'growth_age': v = g * ageL; break;
      case 'size_chains': v = L * ch; break;
      case 'young': v = d !== null && d < 365 ? 1 : 0; break;
      case 'mid_age': v = d !== null && d >= 365 && d < 730 ? 1 : 0; break;
      case 'old': v = d !== null && d >= 730 ? 1 : 0; break;
      case 'age_yrs': v = yrs; break;
      case 'age_yrs2': v = yrs * yrs; break;
      default: return 0;
    }
    var r = M.oddsTermRanges[term];
    return r === undefined ? v : clamp(v, r[0], r[1]);
  }

  function predict(p) {
    // 'cat' is a shrunk offset, not a column: coefficients index only the
    // real columns, so track the coefficient position separately.
    var pred = M.valueBeta[0];
    var bi = 1;
    for (var j = 0; j < M.valueTerms.length; j++) {
      var vt = M.valueTerms[j];
      if (vt === 'cat') continue;
      pred += valueTerm(p, vt) * M.valueBeta[bi++];
    }
    if (M.valueTerms.indexOf('cat') !== -1) pred += M.valueOffsets[p.category || '(none)'] || 0;
    var ratio = Math.exp(pred);
    var z = M.oddsBeta[0];
    var oi = 1;
    for (var k = 0; k < M.oddsTerms.length; k++) {
      var t = M.oddsTerms[k];
      if (t === 'cat') continue;
      z += oddsTerm(p, t) * M.oddsBeta[oi++];
    }
    if (M.oddsTerms.indexOf('cat') !== -1) z += M.oddsOffsets[p.category || '(none)'] || 0;
    // Rounded to 4 decimals first, exactly as lib/model.ts does: the board's
    // implied value is built from the rounded odds, not the raw fit.
    var odds = Math.round(clamp(sigmoid(z), 0.001, 0.999) * 10000) / 10000;
    var implied = Math.max(1, Math.round(p.tvl * ratio * odds));
    var lo = Math.max(1, Math.round(implied * Math.exp(-M.halfWidth)));
    var hi = Math.max(1, Math.round(implied * Math.exp(M.halfWidth)));
    return { pred: pred, ratio: ratio, odds: odds, implied: implied, lo: lo, hi: hi };
  }

  // FNV-1a over "slug:implied|...", mirroring lib/model.ts boardChecksum.
  function checksum(rows) {
    var s = rows.map(function (r) { return r.slug + ':' + r.implied; }).join('|');
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function recompute() {
    var rows = D.rows.map(rowObj);
    var match = 0;
    var mismatches = [];
    for (var i = 0; i < rows.length; i++) {
      var got = predict(rows[i]);
      var want = rows[i];
      if (got.implied === want.implied && got.lo === want.lo && got.hi === want.hi
        && Math.abs(got.odds - want.odds) < 0.00015) {
        match++;
      } else if (mismatches.length < 5) {
        mismatches.push(want.slug);
      }
    }
    return {
      total: rows.length,
      match: match,
      checksumOk: checksum(rows) === D.checksum,
      checksum: D.checksum,
      mismatches: mismatches,
    };
  }

  window.TokenRadarModel = { rowObj: rowObj, predict: predict, recompute: recompute, farmSteps: farmSteps };
})();
