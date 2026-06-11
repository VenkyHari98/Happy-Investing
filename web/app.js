/* ── Format helpers ─────────────────────────────────────────── */
const fmt    = (v, d = 2) => v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtPct = (v) => v == null ? '—' : `${Number(v) >= 0 ? '+' : ''}${fmt(v)}%`;
const fmtCur = (v) => v == null ? '—' : `₹${fmt(v)}`;
const pctCls = (v) => v == null ? '' : v >= 0 ? 'pnl-pos' : 'pnl-neg';
const capCls = (t = '') => t.includes('Large') ? 'cap-large' : t.includes('Mid') ? 'cap-mid' : 'cap-small';
const el     = (id) => document.getElementById(id);

/* ── Pipeline status banner ──────────────────────────────────── */
let _pipelineCheckInterval = null;
let _seenRunDate = null;

function checkPipelineStatus() {
  fetch('/api/pipeline-status')
    .then(r => r.ok ? r.json() : null)
    .then(s => {
      if (!s) return;
      const banner    = el('pipeline-status-banner');
      const textEl    = el('pipeline-status-text');
      const reloadBtn = el('pipeline-reload-btn');
      if (!banner) return;

      if (s.running) {
        banner.style.display = 'flex';
        textEl.textContent   = 'Refreshing data in background...';
        reloadBtn.style.display = 'none';
      } else if (s.error) {
        banner.style.display = 'flex';
        textEl.textContent   = `Data refresh failed: ${s.error}`;
        reloadBtn.style.display = 'none';
        clearInterval(_pipelineCheckInterval);
      } else if (s.completed_at && s.run_date && s.run_date !== _seenRunDate) {
        // Pipeline finished with new data — prompt user (never auto-reload)
        banner.style.display = 'flex';
        textEl.textContent   = `Data updated as of ${s.run_date}`;
        reloadBtn.style.display = 'block';
        clearInterval(_pipelineCheckInterval);
      } else {
        banner.style.display = 'none';
        clearInterval(_pipelineCheckInterval);
      }
    })
    .catch(() => {});
}

checkPipelineStatus();
_pipelineCheckInterval = setInterval(checkPipelineStatus, 8000);

/* ── Backtest horizon toggle (5y / 10y) ─────────────────────── */
let _hz = '10y';
const hzUrl = (base) => `data/${base}_${_hz}.json`;

// Module-scope state hoisted from loadData() so reloadHorizonData() can access them
let _currentTicker = null;
let _overview = [], _stockData = {};
let _slpSector = 'ALL', _slpSearch = '', _slpCap = 'ALL', _slpOpportunity = 'ALL';

function _refreshStockList() {
  renderStockList(_overview, _stockData, _slpSector, _slpSearch, _slpCap, _slpOpportunity);
  document.querySelectorAll('.stock-list-item').forEach((li) => {
    li.addEventListener('click', () => {
      _currentTicker = li.dataset.ticker;
      renderStockDetail(_stockData, _currentTicker);
    });
  });
  if (_currentTicker) setActiveListItem(_currentTicker);
}

/* Reload only the horizon-specific data (called on toggle switch) */
async function reloadHorizonData() {
  // 52W summary metrics banner
  fetch(hzUrl('backtest_52w_summary'))
    .then(r => r.ok ? r.json() : {})
    .then(d => {
      render52wSummary(d);
      const luEl = el('last-updated');
      if (luEl && d.backtest_date) luEl.textContent = `Updated: ${d.backtest_date}`;
    }).catch(() => {});

  // 52W stock list + detail chart
  fetch(hzUrl('backtest_52w_stock_data')).then(async r => {
    if (!r.ok) return;
    const d = await r.json();
    _overview = d.overview || [];
    _stockData = d.stock_data || {};
    _currentTicker = _overview[0]?.ticker;
    _refreshStockList();
    if (_currentTicker) renderStockDetail(_stockData, _currentTicker);
  }).catch(() => {});

  // S200 backtest summary + stock data
  Promise.all([fetch(hzUrl('s200_backtest_summary')), fetch(hzUrl('s200_backtest_stock_data'))])
    .then(async ([sumR, stkR]) => {
      if (sumR.ok) initS200AggBacktest(await sumR.json());
      if (stkR.ok) { const d = await stkR.json(); s200BacktestStockData = d.stock_data || {}; }
    }).catch(() => {});

  // F40 portfolio — fixed (primary; re-renders active chart)
  fetch(hzUrl('f40_portfolio_backtest_fixed')).then(async r => {
    if (!r.ok) return;
    portfolioBacktest52wFixed = await r.json();
    portfolioBacktest52wRolling    = null;
    portfolioBacktest52wEnvLong    = null;
    portfolioBacktest52wRallyF40   = null;
    portfolioBacktest52wAllCombined = null;
    _f40ExitMode = 'fixed'; _f40EnvMode = 'none';
    initPortfolioBacktest('w52', portfolioBacktest52wFixed);
    drawPortfolioChart('w52');
    updateExitModeDiffBadge();
  }).catch(() => {});

  // F40 portfolio — rolling
  fetch(hzUrl('f40_portfolio_backtest_rolling')).then(async r => {
    if (!r.ok) return;
    portfolioBacktest52wRolling = await r.json();
    updateExitModeDiffBadge();
  }).catch(() => {});

  // F40 portfolio — envelope long
  fetch(hzUrl('f40_portfolio_backtest_fixed_env-long')).then(async r => {
    if (!r.ok) return;
    portfolioBacktest52wEnvLong = await r.json();
    updateEnvDiffBadge('long', portfolioBacktest52wEnvLong, 'f40-env-diff-long',
      '#f40-exit-mode-bar .env-btn[data-env="long"]');
  }).catch(() => {});

  // F40 portfolio — rally F40
  fetch(hzUrl('f40_portfolio_backtest_fixed_rally-f40')).then(async r => {
    if (!r.ok) return;
    portfolioBacktest52wRallyF40 = await r.json();
    updateEnvDiffBadge('rally-f40', portfolioBacktest52wRallyF40, 'f40-rally-diff',
      '#f40-exit-mode-bar .env-btn[data-env="rally-f40"]');
  }).catch(() => {});

  // F40 portfolio — all 3 combined
  fetch(hzUrl('f40_portfolio_backtest_fixed_env-long_rally-f40')).then(async r => {
    if (!r.ok) return;
    portfolioBacktest52wAllCombined = await r.json();
    updateEnvDiffBadge('all', portfolioBacktest52wAllCombined, 'f40-all3-diff',
      '#f40-exit-mode-bar .env-btn[data-env="all"]');
  }).catch(() => {});

  // S200 portfolio
  fetch(hzUrl('s200_portfolio_backtest')).then(async r => {
    if (!r.ok) return;
    initPortfolioBacktest('s200', await r.json());
    drawPortfolioChart('s200');
  }).catch(() => {});
}

document.querySelectorAll('.hz-btn').forEach(btn => btn.addEventListener('click', () => {
  const newHz = btn.dataset.hz;
  if (newHz === _hz) return;
  _hz = newHz;
  document.querySelectorAll('.hz-btn').forEach(b => b.classList.toggle('active', b === btn));
  reloadHorizonData();
}));

/* ── Left-nav page switching ────────────────────────────────── */
document.querySelectorAll('.nav-item:not(.disabled)').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    item.classList.add('active');
    el(`page-${item.dataset.page}`)?.classList.add('active');
    el('sidebar').classList.remove('open');
    // Re-render charts that were drawn at fallback dimensions while the page was hidden
    if (item.dataset.page === 'envelope') drawEnvPortfolioChart();
  });
});

el('sidebar-toggle')?.addEventListener('click', () => el('sidebar').classList.toggle('open'));

/* ── Sub-tab switching (52W page) ──────────────────────────── */
document.querySelectorAll('#page-52w .subtab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#page-52w .subtab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.subtab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    el(`subtab-${btn.dataset.subtab}`)?.classList.add('active');
    if (btn.dataset.subtab === 'stock-analysis')      drawChart();
    if (btn.dataset.subtab === 'portfolio-backtest')  drawPortfolioChart('w52');
  });
});

/* ── Exit mode toggle (F40 portfolio backtest) ──────────────── */
document.querySelectorAll('#f40-exit-mode-bar .exit-mode-btn:not(.env-btn)').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    _f40ExitMode = btn.dataset.mode;
    _f40EnvMode  = 'none';
    document.querySelectorAll('#f40-exit-mode-bar .exit-mode-btn:not(.env-btn)').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('#f40-exit-mode-bar .env-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector('#f40-exit-mode-bar .env-btn[data-env="none"]')?.classList.add('active');
    const data = _activeF40Data();
    if (data) initPortfolioBacktest('w52', data);
    drawPortfolioChart('w52');
  });
});

/* ── Envelope strategy toggle (F40 portfolio backtest) ──────── */
document.querySelectorAll('#f40-exit-mode-bar .env-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    _f40EnvMode = btn.dataset.env;
    document.querySelectorAll('#f40-exit-mode-bar .env-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const data = _activeF40Data();
    if (data) initPortfolioBacktest('w52', data);
    drawPortfolioChart('w52');
  });
});

/* ── S200 sub-tab switching ─────────────────────────────────── */
document.querySelectorAll('.s200-subtab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.s200-subtab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.s200-subtab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    el(`s200tab-${btn.dataset.s200tab}`)?.classList.add('active');
    if (btn.dataset.s200tab === 'stock-analysis')     drawRallyChart();
    if (btn.dataset.s200tab === 'portfolio-backtest') drawPortfolioChart('s200');
  });
});

/* ── Metric card builder ─────────────────────────────────────── */
function buildMetricCards(container, cards) {
  if (!container) return;
  container.innerHTML = '';
  cards.forEach(({ label, value, sub, cls }) => {
    container.insertAdjacentHTML('beforeend', `
      <div class="metric-card">
        <div class="metric-label">${label}</div>
        <div class="metric-value ${cls || ''}">${value}</div>
        ${sub ? `<div class="metric-sub">${sub}</div>` : ''}
      </div>`);
  });
}

/* ── Strategy-level summary ──────────────────────────────────── */
function render52wSummary(summary) {
  const m = summary.metrics || {};
  buildMetricCards(el('metric-row-52w'), [
    { label: 'Completed Trades',  value: m.total_trades ?? '—',        cls: 'accent' },
    { label: 'Open (Holding)',     value: summary.open_positions ?? '—', cls: 'amber', sub: 'target not yet hit' },
    { label: 'Win Rate',           value: fmtPct(m.win_rate),            cls: 'green' },
    { label: 'CAGR',               value: fmtPct(m.cagr),               cls: m.cagr >= 0 ? 'green' : 'red' },
    { label: 'Avg Trade P/L',      value: fmtPct(m.avg_trade_pnl_pct),  cls: pctCls(m.avg_trade_pnl_pct) },
    { label: 'Best Trade',         value: fmtPct(m.max_gain_pct),       cls: 'green' },
    { label: 'Avg Duration',       value: m.avg_trade_duration_days ? `${Math.round(m.avg_trade_duration_days)}d` : '—', sub: 'target exit only' },
    { label: 'Stocks Tested',      value: summary.stocks_tested ?? '—' },
  ]);
}

/* ══════════════════════════════════════════════════════════════
   OPPORTUNITY SCANNER  (Sub-tab 1)
═══════════════════════════════════════════════════════════════ */
let scannerRows     = [];
let w52StatusFilter = 'ALL';

const W52_STATUS_PRIORITY = {
  IN_ZONE:     0,
  APPROACHING: 1,
  NEAR:        2,
  BEYOND:      3,
};

function abcdLevels(price) {
  return [
    price * 0.90,
    price * 0.81,
    price * 0.729,
    price * 0.6561,
  ];
}

/* Classify F40 stock by proximity to its rolling 52W low — 3 actionable zones */
function getStatus52w(row) {
  const dist = row.distance_to_52w_low_pct ?? 999;
  if (dist <= 2)  return 'IN_ZONE';    // within 2% — buy signal
  if (dist <= 15) return 'APPROACHING'; // pulling back, getting close
  if (dist <= 40) return 'NEAR';        // around 200 DMA territory
  return 'BEYOND';                      // far from low, no action yet
}

function w52StatusBadge(status) {
  const map = {
    IN_ZONE:      ['rally-in-zone',     'At 52W Low'],
    APPROACHING:  ['rally-approaching', 'Approaching'],
    NEAR:         ['rally-near',        'Near DMA'],
    BEYOND:       ['rally-watching',    'Watching'],
    // backward-compat for old JSON values
    WATCHING_NEAR:['rally-near',        'Near DMA'],
    WATCHING:     ['rally-watching',    'Watching'],
    BELOW_BUY:    ['rally-below',       'Below Buy'],
  };
  const [cls, label] = map[status] || ['rally-watching', status || 'Watching'];
  return `<span class="rally-badge ${cls}">${label}</span>`;
}

function signalPillHtml(signals) {
  return (signals || []).map((s) => {
    const cls = s.includes('52W_LOW') ? 'signal-buy'
              : s.includes('52W_HIGH') ? 'signal-sell'
              : s.includes('ENVELOPE') ? 'signal-env'
              : s.includes('ABCD') ? 'signal-abcd'
              : 'signal-none';
    const label = s.replace(/_/g, ' ').replace('CANDIDATE', '').trim();
    return `<span class="signal-pill ${cls}">${label}</span>`;
  }).join('');
}

function renderScanner(rows) {
  const body = el('scanner-body');
  body.innerHTML = '';
  const emptyEl = el('scanner-empty');
  const cntEl   = el('scanner-count');
  if (cntEl) cntEl.textContent = rows.length;
  if (!rows.length) { emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';

  rows.forEach((row) => {
    const close   = row.close, w52l = row['52w_low'], w52h = row['52w_high'];
    const dist    = row.distance_to_52w_low_pct;
    const gain    = w52h && close ? ((w52h - close) / close) * 100 : null;
    const dma     = row.ma;
    const distDma = row.distance_to_lower_envelope_pct;
    const [a, b, c, d] = abcdLevels(w52l || close);
    const isCandidate = (row.signals || []).includes('52W_LOW_BUY_CANDIDATE');
    const barW    = Math.max(0, Math.min(100, 100 - (dist || 0) * 12));
    const distCls = isCandidate ? 'dist-green' : (dist < 10 ? 'dist-amber' : 'dist-muted');
    const dmaCls  = distDma == null ? '' : distDma < 0 ? 'pnl-neg' : 'pnl-pos';

    body.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${row.ticker}</td>
        <td><span class="cap-badge ${capCls(row.cap_tier)}">${row.cap_tier.replace(' Cap','')}</span></td>
        <td style="color:var(--muted)">${row.sector}</td>
        <td>${fmtCur(close)}</td>
        <td style="color:var(--green)">${fmtCur(w52l)}</td>
        <td><div class="dist-cell"><div class="dist-bar-wrap"><div class="dist-bar" style="width:${barW}%"></div></div><span class="dist-text ${distCls}">${fmtPct(dist)}</span></div></td>
        <td style="color:var(--red)">${fmtCur(w52h)}</td>
        <td class="${pctCls(gain)}">${fmtPct(gain)}</td>
        <td style="color:var(--amber)">${fmtCur(dma)}</td>
        <td class="${dmaCls}" style="font-size:0.8rem">${fmtPct(distDma)}</td>
        <td style="color:var(--muted);font-size:0.8rem">${fmtCur(a)}</td>
        <td style="color:var(--muted);font-size:0.8rem">${fmtCur(b)}</td>
        <td style="color:var(--muted);font-size:0.8rem">${fmtCur(c)}</td>
        <td style="color:var(--muted);font-size:0.8rem">${fmtCur(d)}</td>
        <td>${w52StatusBadge(getStatus52w(row))}</td>
      </tr>`);
  });
}


/* Recompute pill counts from sector/cap/search only (excludes status filter so counts stay live) */
function update52wPillCounts() {
  const q   = (el('scanner-search')?.value || '').toLowerCase();
  const sec = el('scanner-sector')?.value  || 'ALL';
  const cap = el('scanner-cap')?.value     || 'ALL';

  const base = scannerRows.filter((r) => {
    if (q && !r.ticker.toLowerCase().includes(q)) return false;
    if (sec !== 'ALL' && r.sector   !== sec) return false;
    if (cap !== 'ALL' && r.cap_tier !== cap) return false;
    return true;
  });

  const c = { IN_ZONE: 0, APPROACHING: 0, NEAR: 0 };
  base.forEach((r) => { const s = getStatus52w(r); if (s in c) c[s]++; });

  const setW = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  setW('w52-sfb-zone', c.IN_ZONE);
  setW('w52-sfb-app',  c.APPROACHING);
  setW('w52-sfb-near', c.NEAR);
}

function filterSortScanner() {
  update52wPillCounts();

  const q    = (el('scanner-search')?.value || '').toLowerCase();
  const sec  = el('scanner-sector')?.value  || 'ALL';
  const cap  = el('scanner-cap')?.value     || 'ALL';
  const sort = el('scanner-sort')?.value    || 'status';

  let rows = scannerRows.filter((r) => {
    if (q   && !r.ticker.toLowerCase().includes(q)) return false;
    if (sec !== 'ALL' && r.sector   !== sec) return false;
    if (cap !== 'ALL' && r.cap_tier !== cap) return false;
    if (w52StatusFilter !== 'ALL' && getStatus52w(r) !== w52StatusFilter) return false;
    return true;
  });

  rows = [...rows].sort((a, b) => {
    if (sort === 'status') {
      const pa = W52_STATUS_PRIORITY[getStatus52w(a)] ?? 99;
      const pb = W52_STATUS_PRIORITY[getStatus52w(b)] ?? 99;
      if (pa !== pb) return pa - pb;
      return (a.distance_to_52w_low_pct ?? 0) - (b.distance_to_52w_low_pct ?? 0);
    }
    if (sort === 'distance')  return (a.distance_to_52w_low_pct  || 999) - (b.distance_to_52w_low_pct  || 999);
    if (sort === 'dist-high') return (a.distance_to_52w_high_pct || 999) - (b.distance_to_52w_high_pct || 999);
    if (sort === 'gain') {
      const ga = a['52w_high'] && a.close ? (a['52w_high'] - a.close) / a.close : 0;
      const gb = b['52w_high'] && b.close ? (b['52w_high'] - b.close) / b.close : 0;
      return gb - ga;
    }
    return a.ticker.localeCompare(b.ticker);
  });
  renderScanner(rows);
}


function populateSectorFilter(rows, ...selectors) {
  const sectors = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort();
  selectors.forEach((selId) => {
    const sel = el(selId);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="ALL">All sectors</option>';
    sectors.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      sel.appendChild(opt);
    });
    if (cur && sectors.includes(cur)) sel.value = cur;
  });
}

/* ══════════════════════════════════════════════════════════════
   SVG CHART
═══════════════════════════════════════════════════════════════ */
let chartState = { prices: [], trades: [], openPositions: [], rangeYears: 0 };

function drawChart() {
  const svg = el('main-chart');
  const tooltip = el('chart-tooltip');
  if (!svg) return;
  svg.innerHTML = '';

  const { prices: allPrices, trades, openPositions, rangeYears } = chartState;
  let prices = allPrices;
  if (rangeYears > 0) {
    const cut = new Date();
    cut.setFullYear(cut.getFullYear() - rangeYears);
    const cutStr = cut.toISOString().slice(0, 10);
    prices = allPrices.filter((p) => p.date >= cutStr);
  }
  if (!prices.length) return;

  const W = svg.clientWidth || 860;
  const H = svg.clientHeight || 340;
  const PL = 58, PR = 12, PT = 14, PB = 30;
  const CW = W - PL - PR, CH = H - PT - PB;
  const ns = 'http://www.w3.org/2000/svg';

  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    parent.appendChild(e);
    return e;
  };

  const allVals = prices.flatMap((p) => [p.close, p.w52_high, p.w52_low, p.ma200].filter(Boolean));
  const minV = Math.min(...allVals) * 0.98;
  const maxV = Math.max(...allVals) * 1.02;
  const rng  = maxV - minV || 1;

  const xPos = (i) => PL + (i / (prices.length - 1 || 1)) * CW;
  const yPos = (v) => PT + CH - ((v - minV) / rng) * CH;

  // Grid lines + y-labels
  for (let i = 0; i <= 4; i++) {
    const v = minV + (rng / 4) * i, yp = yPos(v);
    mk('line', { x1: PL, x2: PL + CW, y1: yp, y2: yp, stroke: '#1c2e45', 'stroke-width': '1' }, svg);
    const t = mk('text', { x: PL - 6, y: yp + 4, 'text-anchor': 'end', fill: '#4e6278', 'font-size': '11', 'font-family': 'JetBrains Mono,monospace' }, svg);
    t.textContent = fmt(v, 0);
  }

  // X labels
  for (let k = 0; k <= 5; k++) {
    const idx = Math.round((k / 5) * (prices.length - 1));
    const t = mk('text', { x: xPos(idx), y: H - 4, 'text-anchor': 'middle', fill: '#4e6278', 'font-size': '11', 'font-family': 'JetBrains Mono,monospace' }, svg);
    t.textContent = prices[idx]?.date?.slice(0, 7) || '';
  }

  // Band series
  const drawSeries = (color, key, dash) => {
    let d = '';
    prices.forEach((p, i) => {
      if (p[key] == null) return;
      d += `${d === '' || prices[i - 1]?.[key] == null ? 'M' : 'L'} ${xPos(i)} ${yPos(p[key])} `;
    });
    if (!d) return;
    const attr = { d: d.trim(), fill: 'none', stroke: color, 'stroke-width': '1.5' };
    if (dash) attr['stroke-dasharray'] = '5,4';
    mk('path', attr, svg);
  };

  drawSeries('#22c55e', 'w52_low',  true);
  drawSeries('#ef4444', 'w52_high', true);
  drawSeries('#f59e0b', 'ma200',    true);

  // Close price (solid, on top)
  const closePath = prices.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yPos(p.close)}`).join(' ');
  mk('path', { d: closePath, fill: 'none', stroke: '#38bdf8', 'stroke-width': '2' }, svg);

  const pStart = prices[0]?.date, pEnd = prices[prices.length - 1]?.date;

  // Completed trade markers
  trades.forEach((t) => {
    if (t.entry_date >= pStart && t.entry_date <= pEnd) {
      const ei = prices.findIndex((p) => p.date >= t.entry_date);
      if (ei !== -1) mk('circle', { cx: xPos(ei), cy: yPos(prices[ei].close), r: '5', fill: '#22c55e', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    }
    if (t.exit_date >= pStart && t.exit_date <= pEnd) {
      const xi = prices.findIndex((p) => p.date >= t.exit_date);
      if (xi !== -1) mk('circle', { cx: xPos(xi), cy: yPos(prices[xi].close), r: '5', fill: '#ef4444', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    }
  });

  // Open position entry markers (amber)
  openPositions.forEach((pos) => {
    if (pos.entry_date >= pStart && pos.entry_date <= pEnd) {
      const oi = prices.findIndex((p) => p.date >= pos.entry_date);
      if (oi !== -1) mk('circle', { cx: xPos(oi), cy: yPos(prices[oi].close), r: '6', fill: '#f59e0b', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    }
    // Fixed target line
    if (pos.exit_target) {
      const ty = yPos(pos.exit_target);
      if (ty >= PT && ty <= PT + CH) {
        mk('line', { x1: PL, x2: PL + CW, y1: ty, y2: ty, stroke: '#f59e0b', 'stroke-width': '1', 'stroke-dasharray': '3,3', opacity: '0.5' }, svg);
      }
    }
  });

  // Hover overlay + tooltip
  const overlay = mk('rect', { x: PL, y: PT, width: CW, height: CH, fill: 'transparent', cursor: 'crosshair' }, svg);
  const crossV  = mk('line', { x1: 0, x2: 0, y1: PT, y2: PT + CH, stroke: '#475569', 'stroke-width': '1', 'stroke-dasharray': '3,3', visibility: 'hidden' }, svg);

  overlay.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const idx  = Math.max(0, Math.min(prices.length - 1, Math.round(((e.clientX - rect.left - PL) / CW) * (prices.length - 1))));
    const p = prices[idx];
    if (!p) return;
    const xp = xPos(idx);
    crossV.setAttribute('x1', xp); crossV.setAttribute('x2', xp); crossV.setAttribute('visibility', 'visible');
    tooltip.style.display = 'block';
    tooltip.innerHTML = `
      <div class="tooltip-date">${p.date}</div>
      <div class="tooltip-row"><span class="tooltip-label">Close</span><span class="tooltip-val" style="color:#38bdf8">${fmtCur(p.close)}</span></div>
      ${p.w52_low  != null ? `<div class="tooltip-row"><span class="tooltip-label">52W Low</span><span class="tooltip-val" style="color:#22c55e">${fmtCur(p.w52_low)}</span></div>` : ''}
      ${p.w52_high != null ? `<div class="tooltip-row"><span class="tooltip-label">52W High</span><span class="tooltip-val" style="color:#ef4444">${fmtCur(p.w52_high)}</span></div>` : ''}
      ${p.ma200    != null ? `<div class="tooltip-row"><span class="tooltip-label">200 DMA</span><span class="tooltip-val" style="color:#f59e0b">${fmtCur(p.ma200)}</span></div>` : ''}
    `;
    const tipW = 170;
    const left = xp + PL + 12 + tipW > W ? xp + PL - tipW - 12 : xp + PL + 12;
    tooltip.style.left = `${left}px`; tooltip.style.top = `${PT + 8}px`;
  });
  overlay.addEventListener('mouseleave', () => { crossV.setAttribute('visibility', 'hidden'); tooltip.style.display = 'none'; });
}

document.querySelectorAll('.range-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    chartState.rangeYears = parseInt(btn.dataset.range, 10);
    drawChart();
  });
});
window.addEventListener('resize', drawChart);

/* ══════════════════════════════════════════════════════════════
   STOCK ANALYSIS  (Sub-tab 2)
═══════════════════════════════════════════════════════════════ */

function renderStockList(overview, stockData, sectorFilter, searchQ, capFilter, opportunityFilter) {
  const list = el('stock-list');
  if (!list) return;
  list.innerHTML = '';

  // Build current-scanner lookup for opportunity filter (F40 live proximity data)
  const scanMap = new Map(scannerRows.map((r) => [r.ticker, r]));

  let items = overview;
  if (sectorFilter      && sectorFilter      !== 'ALL') items = items.filter((s) => (stockData[s.ticker]?.sector || s.sector) === sectorFilter);
  if (capFilter         && capFilter         !== 'ALL') items = items.filter((s) => (stockData[s.ticker]?.cap_tier || s.cap_tier) === capFilter);
  if (opportunityFilter && opportunityFilter !== 'ALL') items = items.filter((s) => {
    const scanRow = scanMap.get(s.ticker);
    return scanRow && getStatus52w(scanRow) === opportunityFilter;
  });
  if (searchQ) items = items.filter((s) => s.ticker.toLowerCase().includes(searchQ.toLowerCase()));

  items.forEach((s) => {
    const d = stockData[s.ticker] || {};
    const pnlCls = s.total_pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    const hasOpen = s.open_count > 0;
    const li = document.createElement('li');
    li.className = 'stock-list-item';
    li.dataset.ticker = s.ticker;
    li.innerHTML = `
      <div class="sli-top">
        <span class="sli-ticker">${s.ticker}</span>
        <div style="display:flex;gap:0.35rem;align-items:center">
          <span class="sli-trades">${s.trades_count}T</span>
          ${hasOpen ? '<span class="sli-open-dot"></span>' : ''}
        </div>
      </div>
      <div class="sli-sector">${d.sector || s.sector || '—'} · <span class="cap-badge ${capCls(d.cap_tier || s.cap_tier)}">${(d.cap_tier || s.cap_tier || '').replace(' Cap','')}</span></div>
      <div class="sli-pnl ${pnlCls}">P/L ${fmtCur(s.total_pnl)}</div>
    `;
    list.appendChild(li);
  });
}

function setActiveListItem(ticker) {
  document.querySelectorAll('.stock-list-item').forEach((li) => {
    li.classList.toggle('active', li.dataset.ticker === ticker);
  });
}

function renderStockDetail(stockData, ticker) {
  const d = stockData[ticker];
  if (!d) return;

  setActiveListItem(ticker);

  const trades    = d.trades || [];
  const openPos   = d.open_positions || [];
  const stockPnl  = trades.reduce((s, t) => s + (t.net_pnl || 0), 0);
  const wins      = trades.filter((t) => t.pnl_pct > 0).length;
  const winRate   = trades.length ? (wins / trades.length) * 100 : 0;
  const avgDur    = trades.length ? trades.reduce((s, t) => s + t.trade_duration_days, 0) / trades.length : 0;
  const bestTrade = trades.length ? Math.max(...trades.map((t) => t.pnl_pct)) : null;
  const avgPnl    = trades.length ? trades.reduce((s, t) => s + t.pnl_pct, 0) / trades.length : 0;

  buildMetricCards(el('stock-metric-row'), [
    { label: 'Completed Trades', value: trades.length,              cls: 'accent' },
    { label: 'Open Positions',   value: openPos.length,             cls: openPos.length ? 'amber' : '' },
    { label: 'Win Rate',         value: `${fmt(winRate, 1)}%`,      cls: 'green' },
    { label: 'Total P/L',        value: fmtCur(stockPnl),           cls: pctCls(stockPnl) },
    { label: 'Avg Trade P/L',    value: fmtPct(avgPnl),             cls: pctCls(avgPnl) },
    { label: 'Best Trade',       value: fmtPct(bestTrade),          cls: 'green' },
    { label: 'Avg Duration',     value: avgDur ? `${Math.round(avgDur)}d` : '—' },
    { label: 'Latest Close',     value: fmtCur(d.latest_close) },
    { label: 'Current PE',       value: d.pe_current  != null ? fmt(d.pe_current,  1) + 'x' : '—' },
    { label: '3Yr Avg PE',       value: d.pe_3yr_avg  != null ? fmt(d.pe_3yr_avg,  1) + 'x' : '—', sub: '3-year historical avg' },
    { label: '5Yr Avg PE',       value: d.pe_5yr_avg  != null ? fmt(d.pe_5yr_avg,  1) + 'x' : '—', sub: '5-year historical avg' },
  ]);

  // Open positions panel
  const panel = el('open-pos-panel');
  if (openPos.length) {
    panel.style.display = 'block';
    const entries = el('opo-entries');
    entries.innerHTML = '';
    openPos.forEach((pos, idx) => {
      entries.insertAdjacentHTML('beforeend', `
        <div class="opo-entry">
          <div class="opo-entry-label">Position ${idx + 1}</div>
          <div class="opo-grid">
            <div class="opo-item"><div class="opo-label">Entry Date</div><div class="opo-val">${pos.entry_date}</div></div>
            <div class="opo-item"><div class="opo-label">Entry Price</div><div class="opo-val">${fmtCur(pos.entry_price)}</div></div>
            <div class="opo-item"><div class="opo-label">Fixed Target</div><div class="opo-val">${fmtCur(pos.exit_target)}</div></div>
            <div class="opo-item"><div class="opo-label">Latest Close</div><div class="opo-val">${fmtCur(pos.latest_close)}</div></div>
            <div class="opo-item"><div class="opo-label">Days Held</div><div class="opo-val">${pos.days_held}d</div></div>
            <div class="opo-item"><div class="opo-label">Unrealised</div><div class="opo-val ${pctCls(pos.unrealised_pct)}">${fmtPct(pos.unrealised_pct)}</div></div>
            <div class="opo-item"><div class="opo-label">To Target</div><div class="opo-val">${fmtPct(pos.pct_to_target)}</div></div>
          </div>
        </div>`);
    });
  } else {
    panel.style.display = 'none';
  }

  // Trade log title
  const titleEl = el('stock-trade-title');
  if (titleEl) titleEl.textContent = `${ticker} — ${d.sector} · ${d.cap_tier} · ${trades.length} completed trade${trades.length !== 1 ? 's' : ''}`;

  // Trade table (completed trades)
  const body = el('stock-trades-body');
  body.innerHTML = '';
  if (!trades.length) {
    body.insertAdjacentHTML('beforeend', '<tr><td colspan="10" style="text-align:center;color:var(--muted)">No completed trades in the backtest period</td></tr>');
  } else {
    trades.forEach((t, idx) => {
      body.insertAdjacentHTML('beforeend', `
        <tr>
          <td style="color:var(--muted)">${idx + 1}</td>
          <td>${t.entry_date}</td>
          <td>${fmtCur(t.entry_price)}</td>
          <td style="color:var(--red)">${fmtCur(t.exit_price)}</td>
          <td>${t.exit_date}</td>
          <td style="color:var(--accent)">${fmtCur(t.exit_price)}</td>
          <td style="color:var(--muted)">${t.trade_duration_days}d</td>
          <td class="${pctCls(t.pnl_pct)}">${fmtPct(t.pnl_pct)}</td>
          <td class="${pctCls(t.net_pnl)}">${fmtCur(t.net_pnl)}</td>
          <td><span class="exit-badge">${t.exit_reason}</span></td>
        </tr>`);
    });
  }

  // Add open positions as pending rows
  openPos.forEach((pos, idx) => {
    body.insertAdjacentHTML('beforeend', `
      <tr style="opacity:0.8">
        <td style="color:var(--amber)">#</td>
        <td>${pos.entry_date}</td>
        <td>${fmtCur(pos.entry_price)}</td>
        <td style="color:var(--amber)">${fmtCur(pos.exit_target)}</td>
        <td style="color:var(--muted)">—</td>
        <td style="color:var(--muted)">Holding</td>
        <td style="color:var(--muted)">${pos.days_held}d</td>
        <td class="${pctCls(pos.unrealised_pct)}">${fmtPct(pos.unrealised_pct)}</td>
        <td style="color:var(--muted)">—</td>
        <td><span class="exit-badge open">OPEN</span></td>
      </tr>`);
  });

  // Chart
  chartState.prices        = d.prices || [];
  chartState.trades        = trades;
  chartState.openPositions = openPos;
  drawChart();
}

/* ══════════════════════════════════════════════════════════════
   S200 20% RALLY SCANNER
═══════════════════════════════════════════════════════════════ */

let rallyRows         = [];
let rallyStatusFilter = 'ALL';

const RALLY_STATUS_PRIORITY = {
  IN_ZONE:             0,
  IN_ZONE_NEAR_EXPIRY: 1,
  APPROACHING:         2,
  WATCHING_NEAR:       3,
  WATCHING:            4,
  BELOW_BUY:           5,
  EXPIRED:             6,
};

function rallyStatusBadge(status) {
  const map = {
    IN_ZONE:             ['rally-in-zone',     'Buy Zone'],
    IN_ZONE_NEAR_EXPIRY: ['rally-in-zone',     'Buy Zone ⚠'],
    APPROACHING:         ['rally-approaching', 'Approaching'],
    WATCHING_NEAR:       ['rally-near',        'Near'],
    WATCHING:            ['rally-watching',    'Watching'],
    BELOW_BUY:           ['rally-below',       'Below Buy'],
    EXPIRED:             ['rally-expired',     'Expired'],
  };
  const [cls, label] = map[status] || ['rally-expired', status];
  return `<span class="rally-badge ${cls}">${label}</span>`;
}

function distToZoneHtml(distPct, status) {
  if (status === 'IN_ZONE' || status === 'IN_ZONE_NEAR_EXPIRY') {
    return `<span class="dist-text dist-green" style="font-weight:700">IN ZONE</span>`;
  }
  if (distPct == null) return '—';
  if (distPct < 0) {
    return `<span style="color:var(--red);font-size:0.8rem">${fmt(Math.abs(distPct))}% below</span>`;
  }
  const barW  = Math.max(0, Math.min(100, 100 - distPct * 5));
  const cls   = distPct < 2 ? 'dist-green' : distPct < 5 ? 'dist-amber' : 'dist-muted';
  return `<div class="dist-cell">
    <div class="dist-bar-wrap"><div class="dist-bar" style="width:${barW}%"></div></div>
    <span class="dist-text ${cls}">+${fmt(distPct)}%</span>
  </div>`;
}

function renderRallyTable(rows) {
  const body    = el('rally-body');
  const emptyEl = el('rally-empty');
  const cntEl   = el('rally-count');
  body.innerHTML = '';

  if (!rows.length) {
    emptyEl.style.display = 'block';
    if (cntEl) cntEl.textContent = '0';
    return;
  }
  emptyEl.style.display = 'none';
  if (cntEl) cntEl.textContent = rows.length;

  rows.forEach((r) => {
    const gainCls     = (r.remaining_gain_pct || 0) >= 0 ? 'pnl-pos' : 'pnl-neg';
    const expiryWarn  = r.days_to_expiry < 60 ? 'color:var(--amber)' : 'color:var(--muted)';
    const daysLeft    = r.days_to_expiry < 0
      ? `<span style="color:var(--red);font-size:0.7rem">${Math.abs(r.days_to_expiry)}d over</span>`
      : `<span style="${expiryWarn};font-size:0.7rem">${r.days_to_expiry}d left</span>`;

    body.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${r.ticker}</td>
        <td><span class="cap-badge ${capCls(r.cap_tier)}">${r.cap_tier.replace(' Cap','')}</span></td>
        <td style="color:var(--muted);font-size:0.82rem">${r.sector}</td>
        <td>${fmtCur(r.current_price)}</td>
        <td style="font-size:0.82rem">
          <span style="color:var(--green)">${fmtCur(r.buy_zone_low)}</span>
          <span style="color:var(--muted)"> – </span>
          <span style="color:var(--green)">${fmtCur(r.buy_zone_high)}</span>
        </td>
        <td>${distToZoneHtml(r.dist_to_buy_zone_pct, r.status)}</td>
        <td style="color:var(--red)">${fmtCur(r.sell_price)}</td>
        <td class="${gainCls}">${fmtPct(r.remaining_gain_pct)}</td>
        <td style="color:var(--accent);font-weight:600">${fmtPct(r.rally_pct)}</td>
        <td style="color:var(--muted);text-align:center">${r.candle_count}</td>
        <td style="color:var(--muted);font-size:0.8rem">${r.rally_end_date}</td>
        <td style="font-size:0.8rem">${r.expiry_date}<br/>${daysLeft}</td>
        <td style="color:var(--amber)">${fmtCur(r.ma200)}</td>
        <td>${rallyStatusBadge(r.status)}</td>
      </tr>`);
  });
}

/* Recompute status pill counts from watchlist/sector/cap/search (excludes status so counts stay live) */
function updateRallyPillCounts() {
  const q   = (el('rally-search')?.value    || '').toLowerCase();
  const wl  = el('rally-watchlist')?.value  || 'ALL';
  const sec = el('rally-sector')?.value     || 'ALL';
  const cap = el('rally-cap')?.value        || 'ALL';

  const base = rallyRows.filter((r) => {
    if (q  && !r.ticker.toLowerCase().includes(q)) return false;
    if (wl  !== 'ALL' && r.watchlist_source !== wl) return false;
    if (sec !== 'ALL' && r.sector           !== sec) return false;
    if (cap !== 'ALL' && r.cap_tier         !== cap) return false;
    return true;
  });

  const c = { IN_ZONE: 0, APPROACHING: 0, WATCHING_NEAR: 0, WATCHING: 0, BELOW_BUY: 0 };
  base.forEach((r) => {
    const s = r.status === 'IN_ZONE_NEAR_EXPIRY' ? 'IN_ZONE' : r.status;
    if (s in c) c[s]++;
  });

  const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  set('sfb-count-zone',  c.IN_ZONE);
  set('sfb-count-app',   c.APPROACHING);
  set('sfb-count-near',  c.WATCHING_NEAR);
  set('sfb-count-watch', c.WATCHING);
  set('sfb-count-below', c.BELOW_BUY);
}

function filterSortRallies() {
  updateRallyPillCounts();

  const q    = (el('rally-search')?.value     || '').toLowerCase();
  const wl   = el('rally-watchlist')?.value   || 'ALL';
  const sec  = el('rally-sector')?.value      || 'ALL';
  const cap  = el('rally-cap')?.value         || 'ALL';
  const sort = el('rally-sort')?.value        || 'status';

  let rows = rallyRows.filter((r) => {
    if (q   && !r.ticker.toLowerCase().includes(q)) return false;
    if (wl  !== 'ALL' && r.watchlist_source !== wl) return false;
    if (sec !== 'ALL' && r.sector           !== sec) return false;
    if (cap !== 'ALL' && r.cap_tier         !== cap) return false;
    if (rallyStatusFilter !== 'ALL') {
      const match = r.status === rallyStatusFilter ||
        (rallyStatusFilter === 'IN_ZONE' && r.status === 'IN_ZONE_NEAR_EXPIRY');
      if (!match) return false;
    }
    return true;
  });

  rows = [...rows].sort((a, b) => {
    if (sort === 'status') {
      const pa = RALLY_STATUS_PRIORITY[a.status] ?? 99;
      const pb = RALLY_STATUS_PRIORITY[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return (a.dist_to_buy_zone_pct ?? 0) - (b.dist_to_buy_zone_pct ?? 0);
    }
    if (sort === 'dist')      return (a.dist_to_buy_zone_pct ?? 999) - (b.dist_to_buy_zone_pct ?? 999);
    if (sort === 'gain')      return (b.remaining_gain_pct ?? -999)  - (a.remaining_gain_pct ?? -999);
    if (sort === 'expiry')    return (a.days_to_expiry ?? 9999)      - (b.days_to_expiry ?? 9999);
    if (sort === 'rally_pct') return (b.rally_pct ?? 0)              - (a.rally_pct ?? 0);
    return a.ticker.localeCompare(b.ticker);
  });

  renderRallyTable(rows);
}

function initRallyScanner(data) {
  rallyRows = data.rallies || [];

  const sc   = data.status_counts || {};
  const zone = (sc.IN_ZONE || 0) + (sc.IN_ZONE_NEAR_EXPIRY || 0);
  const app  = sc.APPROACHING    || 0;
  const near = sc.WATCHING_NEAR  || 0;
  const wtch = sc.WATCHING       || 0;
  const blow = sc.BELOW_BUY      || 0;

  // Metric cards
  buildMetricCards(el('metric-row-s200rally'), [
    { label: 'In Zone',          value: zone,                   cls: zone  ? 'green' : '',  sub: 'buy zone now' },
    { label: 'Approaching',      value: app,                    cls: app   ? 'amber' : '',  sub: 'within 5% of buy zone' },
    { label: 'Near',             value: near,                   cls: near  ? 'accent' : '', sub: 'within 15%' },
    { label: 'Watching',         value: wtch,                   cls: '',                    sub: 'valid, far from zone' },
    { label: 'Below Buy',        value: blow,                   cls: blow  ? 'amber' : '',  sub: 'ABCD zone — still actionable' },
    { label: 'Stocks w/ Rallies', value: data.stocks_with_rallies ?? '—', cls: 'accent' },
    { label: 'Total Rallies',    value: data.total_rallies ?? '—' },
    { label: 'Last Scanned',     value: data.run_date ?? '—',   cls: '' },
  ]);

  // Status filter count badges
  const setCount = (id, n) => { const e = el(id); if (e) e.textContent = n; };
  setCount('sfb-count-zone',  zone);
  setCount('sfb-count-app',   app);
  setCount('sfb-count-near',  near);
  setCount('sfb-count-watch', wtch);
  setCount('sfb-count-below', blow);

  // Sector filter
  const sectors = [...new Set(rallyRows.map((r) => r.sector).filter(Boolean))].sort();
  const secSel = el('rally-sector');
  if (secSel) {
    secSel.innerHTML = '<option value="ALL">All sectors</option>';
    sectors.forEach((s) => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      secSel.appendChild(o);
    });
  }

  // Status filter pill click
  document.querySelectorAll('.status-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      rallyStatusFilter = btn.dataset.status;
      filterSortRallies();
    });
  });

  // Toolbar events
  el('rally-search')?.addEventListener('input', filterSortRallies);
  el('rally-watchlist')?.addEventListener('change', filterSortRallies);
  el('rally-sector')?.addEventListener('change', filterSortRallies);
  el('rally-cap')?.addEventListener('change', filterSortRallies);
  el('rally-sort')?.addEventListener('change', filterSortRallies);

  filterSortRallies();
}

/* ══════════════════════════════════════════════════════════════
   S200 STOCK ANALYSIS — CHART + DETAIL
═══════════════════════════════════════════════════════════════ */

let rallyChartState = { stockDataMap: null, currentTicker: null, rangeYears: 1 };

function drawRallyChart() {
  const svg     = el('s200-main-chart');
  const tooltip = el('s200-chart-tooltip');
  if (!svg) return;
  svg.innerHTML = '';

  const { stockDataMap, currentTicker, rangeYears } = rallyChartState;
  if (!stockDataMap || !currentTicker) return;

  const sd = stockDataMap[currentTicker];
  if (!sd || !sd.prices || !sd.prices.length) return;

  let prices = sd.prices;
  if (rangeYears > 0) {
    const cut = new Date();
    if (rangeYears < 1) {
      cut.setMonth(cut.getMonth() - Math.round(rangeYears * 12));
    } else {
      cut.setFullYear(cut.getFullYear() - rangeYears);
    }
    const cutStr = cut.toISOString().slice(0, 10);
    prices = sd.prices.filter((p) => p.date >= cutStr);
  }
  if (!prices.length) return;

  const W  = svg.clientWidth  || 860;
  const H  = svg.clientHeight || 340;
  const PL = 72, PR = 12, PT = 14, PB = 30;
  const CW = W - PL - PR, CH = H - PT - PB;
  const ns = 'http://www.w3.org/2000/svg';

  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    parent.appendChild(e);
    return e;
  };

  const rallies = sd.rallies || [];
  const pStart  = prices[0].date;
  const pEnd    = prices[prices.length - 1].date;

  // Y range: OHLC (or close fallback) + ma200 + w52 + all rally price levels
  const hasOHLC = prices[0]?.open != null;
  const allVals = prices.flatMap((p) =>
    (hasOHLC
      ? [p.high, p.low, p.ma200, p.w52_high, p.w52_low]
      : [p.close, p.ma200, p.w52_high, p.w52_low]
    ).filter((v) => v != null)
  );
  rallies.forEach((r) => { allVals.push(r.buy_zone_low, r.sell_price); });
  const minV = Math.min(...allVals) * 0.97;
  const maxV = Math.max(...allVals) * 1.03;
  const rng  = maxV - minV || 1;

  const xPos = (i) => PL + (i / (prices.length - 1 || 1)) * CW;
  const yPos = (v) => PT + CH - ((v - minV) / rng) * CH;

  const dateToX = (ds) => {
    if (ds <= pStart) return PL;
    if (ds >= pEnd)   return PL + CW;
    const idx = prices.findIndex((p) => p.date >= ds);
    return idx === -1 ? PL + CW : xPos(idx);
  };

  // Grid + Y labels
  for (let i = 0; i <= 4; i++) {
    const v = minV + (rng / 4) * i, yp = yPos(v);
    mk('line', { x1: PL, x2: PL + CW, y1: yp, y2: yp, stroke: '#1c2e45', 'stroke-width': '1' }, svg);
    const t = mk('text', { x: PL - 5, y: yp + 4, 'text-anchor': 'end', fill: '#4e6278', 'font-size': '10', 'font-family': 'JetBrains Mono,monospace' }, svg);
    t.textContent = fmt(v, 0);
  }
  // X labels
  for (let k = 0; k <= 5; k++) {
    const idx = Math.round((k / 5) * (prices.length - 1));
    const t = mk('text', { x: xPos(idx), y: H - 4, 'text-anchor': 'middle', fill: '#4e6278', 'font-size': '10', 'font-family': 'JetBrains Mono,monospace' }, svg);
    t.textContent = prices[idx]?.date?.slice(0, 7) || '';
  }

  // ── Rally annotations ─────────────────────────────────────
  [...rallies].reverse().forEach((r) => {
    const opa = r.status === 'IN_ZONE' || r.status === 'IN_ZONE_NEAR_EXPIRY' ? 1.0
              : r.status === 'APPROACHING'   ? 0.75
              : r.status === 'WATCHING_NEAR' ? 0.55
              : r.status === 'WATCHING'      ? 0.40
              : r.status === 'BELOW_BUY'     ? 0.35
              : 0.18;

    const fx1 = dateToX(r.rally_start_date);
    const fx2 = dateToX(r.rally_end_date);
    if (fx2 > fx1 && fx1 < PL + CW && fx2 > PL) {
      mk('rect', {
        x: Math.max(fx1, PL), y: PT,
        width: Math.min(fx2, PL + CW) - Math.max(fx1, PL),
        height: CH, fill: `rgba(34,197,94,${0.12 * opa})`,
      }, svg);
    }

    const bzLowY = yPos(r.buy_zone_low), bzHighY = yPos(r.buy_zone_high);
    const bzTop  = Math.min(bzLowY, bzHighY);
    const bzH    = Math.abs(bzLowY - bzHighY);
    if (bzTop < PT + CH && bzTop + bzH > PT) {
      mk('rect', {
        x: PL, y: Math.max(bzTop, PT), width: CW,
        height: Math.min(bzH, CH - Math.max(bzTop - PT, 0)),
        fill: `rgba(34,197,94,${0.2 * opa})`,
        stroke: `rgba(34,197,94,${0.55 * opa})`, 'stroke-width': '0.5',
      }, svg);
    }

    const bY = yPos(r.buy_price);
    if (bY >= PT && bY <= PT + CH) {
      mk('line', { x1: PL, x2: PL + CW, y1: bY, y2: bY,
        stroke: `rgba(34,197,94,${0.75 * opa})`, 'stroke-width': '1', 'stroke-dasharray': '4,3' }, svg);
      mk('text', { x: PL - 3, y: bY + 3, 'text-anchor': 'end',
        fill: `rgba(34,197,94,${0.85 * opa})`, 'font-size': '9', 'font-family': 'JetBrains Mono,monospace', 'font-weight': '700' }, svg).textContent = fmt(r.buy_price, 0);
    }

    const sY = yPos(r.sell_price);
    if (sY >= PT && sY <= PT + CH) {
      mk('line', { x1: PL, x2: PL + CW, y1: sY, y2: sY,
        stroke: `rgba(239,68,68,${0.75 * opa})`, 'stroke-width': '1', 'stroke-dasharray': '6,4' }, svg);
      mk('text', { x: PL - 3, y: sY + 3, 'text-anchor': 'end',
        fill: `rgba(239,68,68,${0.85 * opa})`, 'font-size': '9', 'font-family': 'JetBrains Mono,monospace', 'font-weight': '700' }, svg).textContent = fmt(r.sell_price, 0);
    }
  });

  // 52W High rolling line (purple dashed)
  {
    let d = '';
    prices.forEach((p, i) => {
      if (p.w52_high == null) return;
      d += `${d === '' || prices[i - 1]?.w52_high == null ? 'M' : 'L'} ${xPos(i)} ${yPos(p.w52_high)} `;
    });
    if (d) mk('path', { d: d.trim(), fill: 'none', stroke: '#a78bfa', 'stroke-width': '1', 'stroke-dasharray': '4,3' }, svg);
  }

  // 52W Low rolling line (orange dashed)
  {
    let d = '';
    prices.forEach((p, i) => {
      if (p.w52_low == null) return;
      d += `${d === '' || prices[i - 1]?.w52_low == null ? 'M' : 'L'} ${xPos(i)} ${yPos(p.w52_low)} `;
    });
    if (d) mk('path', { d: d.trim(), fill: 'none', stroke: '#f97316', 'stroke-width': '1', 'stroke-dasharray': '4,3' }, svg);
  }

  // 200 DMA (amber dashed)
  {
    let d = '';
    prices.forEach((p, i) => {
      if (p.ma200 == null) return;
      d += `${d === '' || prices[i - 1]?.ma200 == null ? 'M' : 'L'} ${xPos(i)} ${yPos(p.ma200)} `;
    });
    if (d) mk('path', { d: d.trim(), fill: 'none', stroke: '#f59e0b', 'stroke-width': '1.5', 'stroke-dasharray': '5,4' }, svg);
  }

  // Candlesticks (or close-line fallback for pre-OHLC data)
  if (hasOHLC) {
    const candleW = Math.max(1, (CW / prices.length) * 0.7);
    prices.forEach((p, i) => {
      if (p.open == null || p.high == null || p.low == null) return;
      const cx      = xPos(i);
      const isGreen = p.close >= p.open;
      const color   = isGreen ? '#22c55e' : '#ef4444';
      mk('line', { x1: cx, x2: cx, y1: yPos(p.high), y2: yPos(p.low), stroke: color, 'stroke-width': '1' }, svg);
      const bodyTop = yPos(Math.max(p.open, p.close));
      const bodyBot = yPos(Math.min(p.open, p.close));
      mk('rect', {
        x: cx - candleW / 2, y: bodyTop,
        width: Math.max(1, candleW), height: Math.max(1, bodyBot - bodyTop),
        fill: color,
      }, svg);
    });
  } else {
    const cp = prices.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yPos(p.close)}`).join(' ');
    mk('path', { d: cp, fill: 'none', stroke: '#38bdf8', 'stroke-width': '2' }, svg);
  }

  // Hover overlay + crosshair
  const overlay = mk('rect', { x: PL, y: PT, width: CW, height: CH, fill: 'transparent', cursor: 'crosshair' }, svg);
  const crossV  = mk('line', { x1: 0, x2: 0, y1: PT, y2: PT + CH, stroke: '#475569', 'stroke-width': '1', 'stroke-dasharray': '3,3', visibility: 'hidden' }, svg);

  overlay.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const idx  = Math.max(0, Math.min(prices.length - 1, Math.round(((e.clientX - rect.left - PL) / CW) * (prices.length - 1))));
    const p    = prices[idx];
    if (!p) return;
    const xp = xPos(idx);
    crossV.setAttribute('x1', xp); crossV.setAttribute('x2', xp); crossV.setAttribute('visibility', 'visible');
    tooltip.style.display = 'block';
    tooltip.innerHTML = `
      <div class="tooltip-date">${p.date}</div>
      ${p.open  != null ? `<div class="tooltip-row"><span class="tooltip-label">Open</span><span class="tooltip-val">${fmtCur(p.open)}</span></div>`   : ''}
      ${p.high  != null ? `<div class="tooltip-row"><span class="tooltip-label">High</span><span class="tooltip-val" style="color:#22c55e">${fmtCur(p.high)}</span></div>` : ''}
      ${p.low   != null ? `<div class="tooltip-row"><span class="tooltip-label">Low</span><span class="tooltip-val" style="color:#ef4444">${fmtCur(p.low)}</span></div>`   : ''}
      <div class="tooltip-row"><span class="tooltip-label">Close</span><span class="tooltip-val" style="color:#38bdf8">${fmtCur(p.close)}</span></div>
      ${p.ma200    != null ? `<div class="tooltip-row"><span class="tooltip-label">200 DMA</span><span class="tooltip-val" style="color:#f59e0b">${fmtCur(p.ma200)}</span></div>`     : ''}
      ${p.w52_high != null ? `<div class="tooltip-row"><span class="tooltip-label">52W High</span><span class="tooltip-val" style="color:#a78bfa">${fmtCur(p.w52_high)}</span></div>` : ''}
      ${p.w52_low  != null ? `<div class="tooltip-row"><span class="tooltip-label">52W Low</span><span class="tooltip-val" style="color:#f97316">${fmtCur(p.w52_low)}</span></div>`   : ''}
    `;
    const tipW = 180;
    const left = xp + 12 + tipW > W ? xp - tipW - 12 : xp + 12;
    tooltip.style.left = `${left}px`; tooltip.style.top = `${PT + 8}px`;
  });
  overlay.addEventListener('mouseleave', () => { crossV.setAttribute('visibility', 'hidden'); tooltip.style.display = 'none'; });
}

document.querySelectorAll('.s200-range-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.s200-range-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    rallyChartState.rangeYears = parseFloat(btn.dataset.range);
    drawRallyChart();
  });
});
window.addEventListener('resize', () => {
  if (el('s200tab-stock-analysis')?.classList.contains('active')) drawRallyChart();
});

const WL_BADGE_CLS = { F40: 'cap-large', E40: 'cap-mid', S200: 'cap-small' };

/* ── S200 Stock list ─────────────────────────────────────────── */
function renderS200StockList(overview, sectorFilter, watchlistFilter, searchQ, capFilter, statusFilter) {
  const list = el('s200-stock-list');
  if (!list) return;
  list.innerHTML = '';

  let items = overview || [];
  if (sectorFilter    && sectorFilter    !== 'ALL') items = items.filter((s) => s.sector           === sectorFilter);
  if (watchlistFilter && watchlistFilter !== 'ALL') items = items.filter((s) => s.watchlist_source === watchlistFilter);
  if (capFilter       && capFilter       !== 'ALL') items = items.filter((s) => s.cap_tier         === capFilter);
  if (statusFilter    && statusFilter    !== 'ALL') items = items.filter((s) => {
    const st = s.best_status;
    return st === statusFilter || (statusFilter === 'IN_ZONE' && st === 'IN_ZONE_NEAR_EXPIRY');
  });
  if (searchQ) items = items.filter((s) => s.ticker.toLowerCase().includes(searchQ.toLowerCase()));

  items.forEach((s) => {
    const wlSrc = s.watchlist_source || 'S200';
    const li = document.createElement('li');
    li.className = 'stock-list-item';
    li.dataset.ticker = s.ticker;
    li.innerHTML = `
      <div class="sli-top">
        <span class="sli-ticker">${s.ticker}</span>
        <span class="cap-badge ${WL_BADGE_CLS[wlSrc] || 'cap-small'}" style="font-size:0.65rem">${wlSrc}</span>
        ${rallyStatusBadge(s.best_status)}
      </div>
      <div class="sli-sector">${s.sector} · <span class="cap-badge ${capCls(s.cap_tier)}">${s.cap_tier.replace(' Cap','')}</span></div>
      <div style="font-size:0.72rem;margin-top:2px;color:var(--muted)">${s.rally_count} ${s.rally_count === 1 ? 'rally' : 'rallies'} &nbsp;·&nbsp; <span class="pnl-pos">+${fmt(s.best_gain_pct)}%</span> best gain</div>
    `;
    list.appendChild(li);
  });
}

function setS200ActiveItem(ticker) {
  document.querySelectorAll('#s200-stock-list .stock-list-item').forEach((li) => {
    li.classList.toggle('active', li.dataset.ticker === ticker);
  });
}

/* ── S200 Stock detail (chart + table) ──────────────────────── */
function renderS200StockDetail(stockDataMap, ticker) {
  const sd = stockDataMap[ticker];
  if (!sd) return;
  setS200ActiveItem(ticker);

  const rallies = sd.rallies || [];
  const inZone  = rallies.filter((r) => r.status === 'IN_ZONE' || r.status === 'IN_ZONE_NEAR_EXPIRY').length;
  const dmaPct  = sd.current_price && sd.ma200 ? ((sd.current_price - sd.ma200) / sd.ma200 * 100) : null;

  buildMetricCards(el('s200-stock-metric-row'), [
    { label: 'Current Price', value: fmtCur(sd.current_price),    cls: 'accent' },
    { label: '52W High',      value: fmtCur(sd.w52_high),         cls: 'purple' },
    { label: '52W Low',       value: fmtCur(sd.w52_low),          cls: '' },
    { label: '200 DMA',       value: fmtCur(sd.ma200),            cls: 'amber' },
    { label: 'Dist to DMA',   value: fmtPct(dmaPct),              cls: pctCls(dmaPct) },
    { label: 'Rallies Found', value: rallies.length,              cls: rallies.length ? 'accent' : '' },
    { label: 'In Zone',       value: inZone,                      cls: inZone ? 'green' : '' },
    { label: 'Best Status',   value: sd.best_status.replace(/_/g, ' '),
      cls: sd.best_status.startsWith('IN_ZONE') ? 'green' : sd.best_status === 'APPROACHING' ? 'amber' : '' },
    { label: 'Best Gain',     value: fmtPct(sd.best_gain_pct),   cls: 'green' },
    { label: 'Current PE',    value: sd.pe_current  != null ? fmt(sd.pe_current,  1) + 'x' : '—', cls: '' },
    { label: '3Yr Avg PE',    value: sd.pe_3yr_avg  != null ? fmt(sd.pe_3yr_avg,  1) + 'x' : '—', sub: '3-year historical avg' },
    { label: '5Yr Avg PE',    value: sd.pe_5yr_avg  != null ? fmt(sd.pe_5yr_avg,  1) + 'x' : '—', sub: '5-year historical avg' },
    { label: 'Cap',           value: sd.cap_tier,                  sub: sd.sector },
  ]);

  const titleEl = el('s200-stock-title');
  const wlLabel = sd.watchlist_source ? ` [${sd.watchlist_source}]` : '';
  if (titleEl) titleEl.textContent = `${ticker}${wlLabel} — ${sd.sector} · ${sd.cap_tier} · ${rallies.length} ${rallies.length === 1 ? 'rally' : 'rallies'}`;

  // Rally detail table
  const body = el('s200-rally-detail-body');
  body.innerHTML = '';
  rallies.forEach((r, i) => {
    const gainCls  = (r.remaining_gain_pct || 0) >= 0 ? 'pnl-pos' : 'pnl-neg';
    const expTxt   = r.days_to_expiry < 0
      ? `<span style="color:var(--red)">${Math.abs(r.days_to_expiry)}d over</span>`
      : `<span style="color:${r.days_to_expiry < 60 ? 'var(--amber)' : 'var(--muted)'}">${r.days_to_expiry}d left</span>`;
    body.insertAdjacentHTML('beforeend', `
      <tr>
        <td style="color:var(--muted)">${i + 1}</td>
        <td style="font-size:0.8rem">${r.rally_start_date}<br/><span style="color:var(--muted)">→ ${r.rally_end_date}</span></td>
        <td style="text-align:center;color:var(--muted)">${r.candle_count}</td>
        <td style="color:var(--accent);font-weight:600">${fmtPct(r.rally_pct)}</td>
        <td style="font-size:0.82rem">
          <span style="color:var(--green)">${fmtCur(r.buy_zone_low)}</span>
          <span style="color:var(--muted)"> – </span>
          <span style="color:var(--green)">${fmtCur(r.buy_zone_high)}</span>
        </td>
        <td style="color:var(--red)">${fmtCur(r.sell_price)}</td>
        <td class="${gainCls}">${fmtPct(r.remaining_gain_pct)}</td>
        <td>${rallyStatusBadge(r.status)}</td>
        <td>${expTxt}</td>
      </tr>`);
  });

  // Update chart
  rallyChartState.stockDataMap   = stockDataMap;
  rallyChartState.currentTicker  = ticker;
  drawRallyChart();

  // Historical backtest for this stock
  renderS200StockBacktest(ticker);
}

/* ── Init S200 stock analysis panel ─────────────────────────── */
function initS200StockAnalysis(data) {
  const overview     = data.overview    || [];
  const stockDataMap = data.stock_data  || {};

  const sectors = [...new Set(overview.map((s) => s.sector).filter(Boolean))].sort();
  const secSel  = el('s200-slp-sector');
  if (secSel) {
    secSel.innerHTML = '<option value="ALL">All sectors</option>';
    sectors.forEach((s) => { const o = document.createElement('option'); o.value = s; o.textContent = s; secSel.appendChild(o); });
  }

  let currentTicker = overview[0]?.ticker;
  let slpSector = 'ALL', slpWatchlist = 'ALL', slpSearch = '', slpCap = 'ALL', slpStatus = 'ALL';

  function refreshList() {
    renderS200StockList(overview, slpSector, slpWatchlist, slpSearch, slpCap, slpStatus);
    document.querySelectorAll('#s200-stock-list .stock-list-item').forEach((li) => {
      li.addEventListener('click', () => {
        currentTicker = li.dataset.ticker;
        renderS200StockDetail(stockDataMap, currentTicker);
      });
    });
    if (currentTicker) setS200ActiveItem(currentTicker);
  }

  el('s200-slp-sector')?.addEventListener('change', (e) => { slpSector = e.target.value; refreshList(); });
  el('s200-slp-watchlist')?.addEventListener('change', (e) => { slpWatchlist = e.target.value; refreshList(); });
  el('s200-slp-search')?.addEventListener('input', (e) => { slpSearch = e.target.value; refreshList(); });
  el('s200-slp-cap')?.addEventListener('change', (e) => { slpCap = e.target.value; refreshList(); });
  el('s200-slp-status')?.addEventListener('change', (e) => { slpStatus = e.target.value; refreshList(); });

  refreshList();
  if (currentTicker) renderS200StockDetail(stockDataMap, currentTicker);
}

/* ══════════════════════════════════════════════════════════════
   S200 BACKTEST RENDERING
═══════════════════════════════════════════════════════════════ */

let s200BacktestStockData = null;  // keyed by ticker

function initS200AggBacktest(summary) {
  if (!summary) return;
  buildMetricCards(el('s200-agg-bt-metric-row'), [
    { label: 'Total Rallies (5Y)',   value: summary.total_rallies ?? '—',          cls: 'accent' },
    { label: 'Zone Entry Rate',      value: fmtPct(summary.zone_entry_rate_pct),   cls: summary.zone_entry_rate_pct >= 50 ? 'green' : 'amber',
      sub: `${summary.total_entered ?? '—'} of ${summary.total_rallies ?? '—'} rallies triggered` },
    { label: 'Win Rate (on entry)',  value: fmtPct(summary.win_rate_pct),          cls: summary.win_rate_pct >= 50 ? 'green' : 'red',
      sub: `${summary.total_hits ?? '—'} targets hit` },
    { label: 'Overall Success',      value: fmtPct(summary.overall_success_rate_pct), cls: '' },
    { label: 'Avg Days to Target',   value: summary.avg_days_in_trade ? `${Math.round(summary.avg_days_in_trade)}d` : '—' },
    { label: 'Avg Win P/L',          value: summary.avg_pnl_pct != null ? `+${fmt(summary.avg_pnl_pct)}%` : '—', cls: 'green' },
    { label: 'Avg Max Drawdown',     value: summary.avg_max_drawdown_pct != null ? `${fmt(summary.avg_max_drawdown_pct)}%` : '—', cls: 'red' },
    { label: 'Last Run',             value: summary.run_date ?? '—' },
  ]);
}

function renderS200StockBacktest(ticker) {
  const labelEl    = el('s200-bt-label');
  const metricEl   = el('s200-bt-metric-row');
  const tableWrap  = el('s200-bt-table-wrap');
  const emptyEl    = el('s200-bt-empty');
  const bodyEl     = el('s200-bt-trades-body');

  if (!s200BacktestStockData || !s200BacktestStockData[ticker]) {
    if (labelEl)  labelEl.style.display   = 'none';
    if (tableWrap) tableWrap.style.display = 'none';
    if (emptyEl)  { emptyEl.style.display = 'block'; }
    if (metricEl) metricEl.innerHTML = '';
    return;
  }

  if (labelEl) labelEl.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';

  const sd      = s200BacktestStockData[ticker];
  const metrics = sd.metrics || {};
  const trades  = sd.trades  || [];

  // Per-stock metric cards
  buildMetricCards(metricEl, [
    { label: 'Historical Rallies', value: metrics.total_rallies ?? '—',          cls: 'accent' },
    { label: 'Zone Entry Rate',    value: fmtPct(metrics.zone_entry_rate_pct),   cls: (metrics.zone_entry_rate_pct || 0) >= 50 ? 'green' : 'amber',
      sub: `${metrics.entered ?? 0} entered` },
    { label: 'Win Rate',           value: fmtPct(metrics.win_rate_pct),          cls: (metrics.win_rate_pct || 0) >= 50 ? 'green' : 'red',
      sub: `${metrics.target_hit ?? 0} targets hit` },
    { label: 'Expired (no hit)',   value: metrics.expired ?? '—',                cls: metrics.expired ? 'amber' : '' },
    { label: 'Never Triggered',    value: metrics.not_entered ?? '—',            cls: '' },
    { label: 'Avg Days to Target', value: metrics.avg_days_in_trade ? `${Math.round(metrics.avg_days_in_trade)}d` : '—' },
    { label: 'Avg Win P/L',        value: metrics.avg_pnl_pct != null ? `+${fmt(metrics.avg_pnl_pct)}%` : '—', cls: 'green' },
    { label: 'Avg Max Drawdown',   value: metrics.avg_max_drawdown_pct != null ? `${fmt(metrics.avg_max_drawdown_pct)}%` : '—', cls: 'red' },
  ]);

  if (!trades.length) {
    if (tableWrap) tableWrap.style.display = 'none';
    return;
  }
  if (tableWrap) tableWrap.style.display = '';

  bodyEl.innerHTML = '';
  trades.forEach((t, i) => {
    const resultBadge = t.exit_reason === 'TARGET_HIT'
      ? `<span class="exit-badge" style="background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.3)">HIT TARGET</span>`
      : t.exit_reason === 'EXPIRED'
      ? `<span class="exit-badge" style="background:rgba(245,158,11,0.12);color:var(--amber);border-color:rgba(245,158,11,0.3)">EXPIRED</span>`
      : `<span class="exit-badge" style="opacity:0.5">NOT TRIGGERED</span>`;

    const rowOpacity = t.exit_reason === 'NOT_ENTERED' ? 'opacity:0.55' : '';
    const pnlCls     = t.pnl_pct == null ? '' : t.pnl_pct >= 0 ? 'pnl-pos' : 'pnl-neg';
    const ddCls      = t.max_drawdown_pct == null ? '' : t.max_drawdown_pct < -10 ? 'pnl-neg' : '';

    bodyEl.insertAdjacentHTML('beforeend', `
      <tr style="${rowOpacity}">
        <td style="color:var(--muted)">${i + 1}</td>
        <td style="color:var(--muted);font-size:0.8rem">${t.rally_end_date}</td>
        <td style="color:var(--accent);font-weight:600">${fmtPct(t.rally_pct)}</td>
        <td style="font-size:0.8rem">
          <span style="color:var(--green)">${fmtCur(t.buy_zone_low)}</span>
          <span style="color:var(--muted)"> – </span>
          <span style="color:var(--green)">${fmtCur(t.buy_zone_high)}</span>
        </td>
        <td style="color:var(--red)">${fmtCur(t.sell_price)}</td>
        <td style="color:var(--muted);font-size:0.8rem">${t.entry_date ?? '—'}</td>
        <td>${t.entry_price != null ? fmtCur(t.entry_price) : '—'}</td>
        <td style="color:var(--muted);font-size:0.8rem">${t.exit_date ?? '—'}</td>
        <td>${t.exit_price != null ? fmtCur(t.exit_price) : '—'}</td>
        <td style="color:var(--muted)">${t.days_in_trade != null ? t.days_in_trade + 'd' : '—'}</td>
        <td class="${pnlCls}">${t.pnl_pct != null ? fmtPct(t.pnl_pct) : '—'}</td>
        <td class="${ddCls}" style="font-size:0.8rem">${t.max_drawdown_pct != null ? fmtPct(t.max_drawdown_pct) : '—'}</td>
        <td>${resultBadge}</td>
      </tr>`);
  });
}

/* ══════════════════════════════════════════════════════════════
   PORTFOLIO BACKTEST RENDERING
═══════════════════════════════════════════════════════════════ */

let portfolioBacktest52w       = null;   // currently displayed dataset for w52 tab
let portfolioBacktestS200      = null;
let portfolioBacktest52wFixed      = null;   // fixed exit
let portfolioBacktest52wRolling    = null;   // rolling ratchet
let portfolioBacktest52wEnvLong    = null;   // fixed + envelope
let portfolioBacktest52wRallyF40   = null;   // fixed + 20% rally (F40 stocks)
let portfolioBacktest52wAllCombined = null;  // fixed + envelope + rally
let _f40ExitMode = 'fixed';
let _f40EnvMode  = 'none';

function _activeF40Data() {
  if (_f40EnvMode === 'all')       return portfolioBacktest52wAllCombined;
  if (_f40EnvMode === 'long')      return portfolioBacktest52wEnvLong;
  if (_f40EnvMode === 'rally-f40') return portfolioBacktest52wRallyF40;
  return _f40ExitMode === 'rolling' ? portfolioBacktest52wRolling : portfolioBacktest52wFixed;
}

// per-prefix filter state
const _pbFilters = {
  w52:  { search: '', status: 'ALL', cap: 'ALL', tranche: 'ALL', strategy: 'ALL', ticker: null },
  s200: { search: '', status: 'ALL', cap: 'ALL', tranche: 'ALL', strategy: 'ALL', ticker: null },
};

// Currently selected trade row per prefix (for highlight)
const _pbSelectedTrade = { w52: null, s200: null };

// Guard: wire filter/toggle events once per prefix, not every initPortfolioBacktest call
const _pbInited = { w52: false, s200: false };

/* ── Summary metric cards ─────────────────────────────────────── */
function renderPortfolioSummary(prefix, summary) {
  const row = el(`${prefix}-pb-metric-row`);
  if (!row || !summary) return;
  const s = summary;
  buildMetricCards(row, [
    { label: 'Total Return',       value: fmtPct(s.total_return_pct),       cls: s.total_return_pct >= 0 ? 'green' : 'red' },
    { label: 'CAGR / XIRR',       value: fmtPct(s.cagr_pct),               cls: s.cagr_pct >= 0 ? 'green' : 'red',
      sub: s.xirr_pct != null ? `XIRR ${fmtPct(s.xirr_pct)}` : '' },
    { label: 'Final Value',        value: fmtCur(s.final_value),            cls: 'accent' },
    { label: 'Win Rate',           value: fmtPct(s.win_rate_pct),           cls: (s.win_rate_pct || 0) >= 50 ? 'green' : 'amber',
      sub: `${s.wins ?? 0} wins / ${s.total_trades ?? 0} closed` },
    { label: 'Avg Trade Duration', value: s.avg_trade_duration_days ? `${Math.round(s.avg_trade_duration_days)}d` : '—' },
    { label: 'Avg Trade P/L',      value: fmtPct(s.avg_trade_pnl_pct),      cls: (s.avg_trade_pnl_pct || 0) >= 0 ? 'green' : 'red' },
    { label: 'Max Drawdown',       value: s.max_drawdown_pct != null ? `-${fmt(s.max_drawdown_pct)}%` : '—', cls: 'red' },
    { label: 'Time in Market',     value: s.time_in_market_pct != null ? `${fmt(s.time_in_market_pct, 1)}%` : '—' },
    { label: 'Open at End',        value: s.open_at_end ?? '—' },
    { label: 'Expired',            value: s.total_expired ?? 0,             cls: '' },
  ]);
}

/* ── Yearly returns ───────────────────────────────────────────── */
function renderPortfolioYearlyReturns(prefix, summary) {
  const wrap = el(`${prefix}-pb-yearly-wrap`);
  if (!wrap || !summary?.yearly_returns) return;
  const yr = summary.yearly_returns;
  const years = Object.keys(yr).sort();
  if (!years.length) { wrap.innerHTML = ''; return; }

  const maxAbs = Math.max(1, ...years.map((y) => Math.abs(yr[y])));
  const rows = years.map((y) => {
    const v = yr[y];
    const pct = Math.min(100, Math.abs(v) / maxAbs * 100);
    const pos = v >= 0;
    return `<tr>
      <td style="color:var(--muted);width:4rem">${y}</td>
      <td style="width:6rem;font-weight:600;color:var(--${pos ? 'green' : 'red'})">${fmtPct(v)}</td>
      <td>
        <div style="height:10px;border-radius:3px;width:${pct}%;
             background:${pos ? 'var(--green)' : 'var(--red)'};opacity:0.7"></div>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table style="width:100%;border-collapse:collapse">
    <tbody>${rows}</tbody>
  </table>`;
}

/* ── Cap tier stat cards ─────────────────────────────────────── */
function renderPortfolioTierStats(prefix, summary) {
  const row = el(`${prefix}-pb-tier-row`);
  if (!row || !summary?.by_cap_tier) return;
  const cards = [];
  for (const [tier, data] of Object.entries(summary.by_cap_tier)) {
    if (!data.count) continue;
    cards.push({
      label: tier,
      value: fmtPct(data.win_rate_pct),
      cls: (data.win_rate_pct || 0) >= 50 ? 'green' : 'amber',
      sub: `${data.wins}/${data.count} • avg ${fmtPct(data.avg_pnl_pct)}`,
    });
  }
  buildMetricCards(row, cards);
}

/* ── Trade log table ─────────────────────────────────────────── */
function renderPortfolioTradeLog(prefix) {
  const data = prefix === 'w52' ? portfolioBacktest52w : portfolioBacktestS200;
  const body  = el(`${prefix}-pb-trade-body`);
  const empty = el(`${prefix}-pb-empty`);
  if (!body) return;

  if (!data?.trades?.length) {
    body.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const f = _pbFilters[prefix];
  const search    = (f.search   || '').toLowerCase();
  const fStatus   = f.status   || 'ALL';
  const fCap      = f.cap      || 'ALL';
  const fTranche  = f.tranche  || 'ALL';
  const fStrategy = f.strategy || 'ALL';
  const fTicker   = f.ticker   || null;

  const filtered = data.trades.filter((t) => {
    if (search    && !t.ticker.toLowerCase().includes(search)) return false;
    if (fStatus   !== 'ALL' && t.exit_reason !== fStatus)      return false;
    if (fCap      !== 'ALL' && t.cap_tier    !== fCap)         return false;
    if (fTranche  !== 'ALL' && t.tranche     !== fTranche)     return false;
    if (fStrategy !== 'ALL' && t.strategy    !== fStrategy)    return false;
    if (fTicker   && t.ticker !== fTicker)                     return false;
    return true;
  });

  body.innerHTML = '';
  filtered.forEach((t, i) => {
    const outcome = t.exit_reason === 'TARGET_HIT'
      ? `<span class="exit-badge" style="background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.3)">TARGET HIT</span>`
      : t.exit_reason === 'EXPIRED'
      ? `<span class="exit-badge" style="background:rgba(245,158,11,0.12);color:var(--amber);border-color:rgba(245,158,11,0.3)">EXPIRED</span>`
      : `<span class="exit-badge" style="background:rgba(148,163,184,0.12);color:var(--muted)">OPEN</span>`;

    const trancheColor = {
      INITIAL: 'var(--accent)', MOMENTUM: '#a78bfa',
      ABCD_A: '#fb923c', ABCD_B: '#f97316', ABCD_C: '#ea580c', ABCD_D: '#c2410c',
      ENV_LONG: '#60a5fa',
    }[t.tranche] || 'var(--muted)';

    const strategyLabel = t.strategy === 'ENV_LONG'
      ? `<span style="font-size:0.68rem;background:rgba(96,165,250,0.15);color:#60a5fa;border:1px solid rgba(96,165,250,0.3);border-radius:3px;padding:1px 4px;margin-right:3px">ENV↑</span>`
      : '';

    const pnlCls = (t.pnl_pct || 0) >= 0 ? 'pnl-pos' : 'pnl-neg';
    const ddCls  = (t.max_drawdown_pct || 0) < -10 ? 'pnl-neg' : 'pnl-pos';

    const isSelected = _pbSelectedTrade[prefix]?.trade_id === t.trade_id;
    body.insertAdjacentHTML('beforeend', `<tr data-trade-id="${t.trade_id}" class="${isSelected ? 'selected' : ''}">
      <td style="color:var(--muted)">${i + 1}</td>
      <td style="font-weight:600">${t.ticker}</td>
      <td><span class="cap-badge ${capCls(t.cap_tier)}">${t.cap_tier?.replace(' Cap', '') || '—'}</span></td>
      <td style="font-size:0.8rem;font-weight:600">${strategyLabel}<span style="color:${trancheColor}">${t.tranche}</span></td>
      <td style="color:var(--muted);font-size:0.8rem">${t.entry_date ?? '—'}</td>
      <td>${fmtCur(t.entry_price)}</td>
      <td style="color:var(--accent)">${fmtCur(t.exit_target)}</td>
      <td style="color:var(--muted);font-size:0.8rem">${t.exit_date ?? '—'}</td>
      <td>${t.exit_price != null ? fmtCur(t.exit_price) : '—'}</td>
      <td style="color:var(--muted)">${t.trade_duration_days != null ? t.trade_duration_days + 'd' : '—'}</td>
      <td class="${pnlCls}">${t.pnl_pct != null ? fmtPct(t.pnl_pct) : '—'}</td>
      <td class="${pnlCls}">${t.pnl != null ? fmtCur(t.pnl) : '—'}</td>
      <td class="${ddCls}" style="font-size:0.8rem">${t.max_drawdown_pct != null ? fmtPct(t.max_drawdown_pct) : '—'}</td>
      <td>${outcome}</td>
    </tr>`);
  });

  // Click delegation: clicking any row shows the trade detail chart
  body.onclick = (e) => {
    const row = e.target.closest('tr[data-trade-id]');
    if (!row) return;
    const tradeId = row.dataset.tradeId;
    const trade   = data.trades.find((t) => t.trade_id === tradeId);
    if (!trade) return;
    // Toggle selection
    if (_pbSelectedTrade[prefix]?.trade_id === tradeId) {
      _pbSelectedTrade[prefix] = null;
      closePbTradePanel(prefix);
      renderPortfolioTradeLog(prefix);
      return;
    }
    _pbSelectedTrade[prefix] = trade;
    renderPortfolioTradeLog(prefix);
    showTradeChart(prefix, trade);
  };
}

/* ── Ticker pills ─────────────────────────────────────────────── */
function renderPortfolioTickerPills(prefix) {
  const data      = prefix === 'w52' ? portfolioBacktest52w : portfolioBacktestS200;
  const container = el(`${prefix}-pb-ticker-pills`);
  if (!container || !data?.trades?.length) return;

  const tickers = [...new Set(data.trades.map((t) => t.ticker))].sort();
  const active  = _pbFilters[prefix].ticker;
  container.innerHTML = '';

  const mkPill = (label, ticker) => {
    const isActive = ticker === active;
    const btn = document.createElement('button');
    btn.className = `ticker-pill${ticker === null ? ' all-pill' : ''}${isActive || (ticker === null && active === null) ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      _pbFilters[prefix].ticker = (ticker === active) ? null : ticker;
      _pbSelectedTrade[prefix] = null;
      closePbTradePanel(prefix);
      renderPortfolioTickerPills(prefix);
      renderPortfolioTradeLog(prefix);
    });
    container.appendChild(btn);
  };

  mkPill('All', null);
  tickers.forEach((t) => mkPill(t, t));
}

/* ── Trade detail chart ───────────────────────────────────────── */
function closePbTradePanel(prefix) {
  const panel = el(`${prefix}-pb-trade-panel`);
  if (panel) panel.style.display = 'none';
}

function showTradeChart(prefix, trade) {
  const data  = prefix === 'w52' ? portfolioBacktest52w : portfolioBacktestS200;
  const panel = el(`${prefix}-pb-trade-panel`);
  const title = el(`${prefix}-pb-trade-panel-title`);
  const svg   = el(`${prefix}-pb-trade-chart`);
  const ctr   = el(`${prefix}-pb-trade-chart-container`);
  const tip   = el(`${prefix}-pb-trade-chart-tip`);
  if (!panel || !svg || !ctr) return;

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Price series for this ticker
  const allPrices = data?.stock_prices?.[trade.ticker] || [];
  if (!allPrices.length) {
    if (title) title.textContent = `${trade.ticker} — no price data available`;
    svg.innerHTML = '';
    return;
  }

  const isOpen   = trade.exit_reason === 'OPEN';
  const entryIdx = allPrices.findIndex((p) => p.date >= trade.entry_date);
  const lastDate = allPrices[allPrices.length - 1].date;
  const exitDate = isOpen ? lastDate : (trade.exit_date ?? lastDate);
  const exitIdx  = allPrices.findIndex((p) => p.date >= exitDate);
  const CTX      = 25; // context bars before entry and after exit
  const startIdx = Math.max(0, entryIdx - CTX);
  const endIdx   = Math.min(allPrices.length - 1, (exitIdx < 0 ? allPrices.length - 1 : exitIdx) + CTX);
  const prices   = allPrices.slice(startIdx, endIdx + 1);
  if (!prices.length) { panel.style.display = 'none'; return; }

  // Build header title
  const trancheColors = { INITIAL: '#38bdf8', ABCD_A: '#fb923c', ABCD_B: '#f97316', MOMENTUM: '#a78bfa' };
  const tc = trancheColors[trade.tranche] || '#94a3b8';
  const pnlStr = trade.pnl_pct != null ? `<span class="${trade.pnl_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmtPct(trade.pnl_pct)}</span>` : '';
  if (title) {
    title.innerHTML =
      `<span style="color:${tc}">${trade.ticker} &mdash; ${trade.tranche}</span>` +
      `&nbsp;&middot;&nbsp;Entry ${trade.entry_date} @ ${fmtCur(trade.entry_price)}` +
      `&nbsp;&middot;&nbsp;Target ${fmtCur(trade.exit_target)}` +
      (isOpen
        ? `&nbsp;&middot;&nbsp;<span style="color:var(--amber)">OPEN (${trade.trade_duration_days}d) &bull; now ${fmtCur(allPrices[allPrices.length - 1].close)}</span>`
        : `&nbsp;&middot;&nbsp;Exit ${trade.exit_date} @ ${fmtCur(trade.exit_price)}&nbsp;${pnlStr}`);
  }

  // SVG dimensions
  const W  = ctr.clientWidth || 800;
  const H  = 260;
  const PL = 64, PR = 16, PT = 16, PB = 28;
  const CW = W - PL - PR, CH = H - PT - PB;
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (parent) parent.appendChild(e);
    return e;
  };

  // Y range: include entry, target, current price, all close prices
  const closes  = prices.map((p) => p.close);
  const allVals = [...closes, trade.entry_price, trade.exit_target];
  if (!isOpen && trade.exit_price) allVals.push(trade.exit_price);
  const minV = Math.min(...allVals) * 0.967;
  const maxV = Math.max(...allVals) * 1.033;
  const rng  = maxV - minV || 1;

  const n    = prices.length;
  const xPos = (i) => PL + (i / (n - 1 || 1)) * CW;
  const yPos = (v) => PT + CH - ((v - minV) / rng) * CH;

  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';

  // Grid + Y labels
  for (let i = 0; i <= 4; i++) {
    const v = minV + (rng / 4) * i;
    const yp = yPos(v).toFixed(1);
    mk('line', { x1: PL, x2: PL + CW, y1: yp, y2: yp, stroke: '#1c2e45', 'stroke-width': '0.5' }, svg);
    const lbl = mk('text', { x: PL - 5, y: (parseFloat(yp) + 4).toFixed(1), 'text-anchor': 'end', fill: '#4e6278', 'font-size': '10', 'font-family': 'JetBrains Mono,monospace' }, svg);
    lbl.textContent = fmt(v, 0);
  }

  // X labels (monthly)
  const seenMonths = new Set();
  prices.forEach((p, i) => {
    const m = p.date.slice(0, 7);
    if (seenMonths.has(m)) return;
    seenMonths.add(m);
    const lbl = mk('text', { x: xPos(i).toFixed(1), y: H - 4, 'text-anchor': 'middle', fill: '#4e6278', 'font-size': '10', 'font-family': 'JetBrains Mono,monospace' }, svg);
    lbl.textContent = m;
  });

  // Shaded region between entry and exit
  const relEntry = prices.findIndex((p) => p.date >= trade.entry_date);
  const relExit  = isOpen ? prices.length - 1 : prices.findIndex((p) => p.date >= exitDate);
  if (relEntry >= 0 && relExit >= relEntry) {
    mk('rect', {
      x: xPos(relEntry).toFixed(1), y: PT,
      width: (xPos(relExit) - xPos(relEntry)).toFixed(1), height: CH,
      fill: isOpen ? 'rgba(245,158,11,0.05)' : 'rgba(56,189,248,0.05)',
    }, svg);
  }

  // MA200 line
  let maPath = '';
  prices.forEach((p, i) => {
    if (p.ma200 == null) return;
    maPath += `${(!maPath || prices[i - 1]?.ma200 == null) ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(p.ma200).toFixed(1)} `;
  });
  if (maPath) mk('path', { d: maPath.trim(), fill: 'none', stroke: '#f59e0b', 'stroke-width': '1', 'stroke-dasharray': '4,3', opacity: '0.5' }, svg);

  // Target line (green dashed)
  const ty = yPos(trade.exit_target).toFixed(1);
  mk('line', { x1: PL, x2: PL + CW, y1: ty, y2: ty, stroke: '#22c55e', 'stroke-width': '1.5', 'stroke-dasharray': '5,3' }, svg);
  const tgtLbl = mk('text', { x: (PL + CW - 3).toFixed(1), y: (parseFloat(ty) - 4).toFixed(1), 'text-anchor': 'end', fill: '#22c55e', 'font-size': '9', 'font-family': 'JetBrains Mono,monospace' }, svg);
  tgtLbl.textContent = `Target ${fmtCur(trade.exit_target)}`;

  // Entry cost dashed line (for open trades where entry vs current matters)
  if (isOpen) {
    const ey = yPos(trade.entry_price).toFixed(1);
    mk('line', { x1: PL, x2: PL + CW, y1: ey, y2: ey, stroke: '#94a3b8', 'stroke-width': '1', 'stroke-dasharray': '3,3', opacity: '0.5' }, svg);
  }

  // Price line
  const closePath = prices.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(p.close).toFixed(1)}`).join(' ');
  mk('path', { d: closePath, fill: 'none', stroke: '#38bdf8', 'stroke-width': '2', 'stroke-linejoin': 'round' }, svg);

  // Entry marker — green circle + label
  if (relEntry >= 0) {
    const ex = xPos(relEntry).toFixed(1), ey = yPos(prices[relEntry].close).toFixed(1);
    mk('circle', { cx: ex, cy: ey, r: '6', fill: '#22c55e', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    const el2 = mk('text', { x: ex, y: (parseFloat(ey) - 10).toFixed(1), 'text-anchor': 'middle', fill: '#22c55e', 'font-size': '9', 'font-family': 'JetBrains Mono,monospace' }, svg);
    el2.textContent = `Entry ${fmtCur(trade.entry_price)}`;
  }

  // Exit marker (closed trade)
  if (!isOpen && relExit >= 0) {
    const xx = xPos(relExit).toFixed(1), xy = yPos(prices[relExit].close).toFixed(1);
    const exitColor = trade.exit_reason === 'TARGET_HIT' ? '#22c55e' : trade.exit_reason === 'EXPIRED' ? '#f59e0b' : '#ef4444';
    mk('circle', { cx: xx, cy: xy, r: '6', fill: exitColor, stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    const xl = mk('text', { x: xx, y: (parseFloat(xy) + 18).toFixed(1), 'text-anchor': 'middle', fill: exitColor, 'font-size': '9', 'font-family': 'JetBrains Mono,monospace' }, svg);
    xl.textContent = `Exit ${fmtCur(trade.exit_price)}`;
  }

  // Current price marker (open trade)
  if (isOpen) {
    const lastP = prices[prices.length - 1];
    const lx = xPos(prices.length - 1).toFixed(1);
    const ly = yPos(lastP.close).toFixed(1);
    mk('circle', { cx: lx, cy: ly, r: '6', fill: '#f59e0b', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    const ll = mk('text', { x: (parseFloat(lx) - 5).toFixed(1), y: (parseFloat(ly) - 10).toFixed(1), 'text-anchor': 'end', fill: '#f59e0b', 'font-size': '9', 'font-family': 'JetBrains Mono,monospace' }, svg);
    ll.textContent = `Now ${fmtCur(lastP.close)}`;
  }

  // Hover tooltip
  const overlay = mk('rect', { x: PL, y: PT, width: CW, height: CH, fill: 'transparent', style: 'cursor:crosshair' }, svg);
  const vline   = mk('line', { x1: 0, x2: 0, y1: PT, y2: PT + CH, stroke: '#475569', 'stroke-width': '1', 'stroke-dasharray': '3,2', display: 'none' }, svg);

  overlay.addEventListener('mousemove', (e) => {
    const rect  = ctr.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - PL;
    const idx    = Math.max(0, Math.min(n - 1, Math.round(mouseX / CW * (n - 1))));
    const pt     = prices[idx];
    const vx     = xPos(idx).toFixed(1);
    vline.setAttribute('x1', vx); vline.setAttribute('x2', vx); vline.setAttribute('display', '');
    if (tip) {
      tip.style.display = 'block';
      tip.style.left    = `${Math.min(e.clientX - rect.left + 10, W - 160)}px`;
      tip.style.top     = `${e.clientY - rect.top - 10}px`;
      tip.innerHTML     = `<div style="font-weight:600;margin-bottom:3px">${pt.date}</div>
        <div>Close: <b>${fmtCur(pt.close)}</b></div>
        <div style="color:#94a3b8;font-size:0.78rem">vs Entry ${fmtCur(trade.entry_price)}</div>
        <div style="color:#22c55e;font-size:0.78rem">vs Target ${fmtCur(trade.exit_target)}</div>`;
    }
  });
  overlay.addEventListener('mouseleave', () => {
    vline.setAttribute('display', 'none');
    if (tip) tip.style.display = 'none';
  });
}

/* ── Equity curve chart (stacked area: deployed + cash) ──────── */
function drawPortfolioChart(prefix) {
  const data = prefix === 'w52' ? portfolioBacktest52w : portfolioBacktestS200;
  const svg  = el(`${prefix}-pb-chart`);
  const tip  = el(`${prefix}-pb-tooltip`);
  const ctr  = el(`${prefix}-pb-chart-container`);
  if (!svg || !ctr) return;
  if (!data?.equity_curve?.length) { svg.innerHTML = ''; return; }

  const curve = data.equity_curve;
  const W = ctr.clientWidth  || 800;
  const H = ctr.clientHeight || 320;
  const PAD = { top: 16, right: 20, bottom: 30, left: 64 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  // Downsample: one point every ~2 days, max 600 pts
  const step = Math.max(1, Math.floor(curve.length / 600));
  const pts  = curve.filter((_, i) => i % step === 0);
  if (pts[pts.length - 1] !== curve[curve.length - 1]) pts.push(curve[curve.length - 1]);

  const n       = pts.length;
  const allTotal = pts.map((p) => p.total_value);
  const minV    = Math.min(...allTotal) * 0.97;
  const maxV    = Math.max(...allTotal) * 1.03;
  const initCap = data.meta?.initial_capital || 100000;

  const xScale = (i) => PAD.left + (i / (n - 1)) * cW;
  const yScale = (v) => PAD.top  + cH - ((v - minV) / (maxV - minV)) * cH;

  // Cash filled area: from chart bottom → cash line → back to bottom
  const cashAreaPath = `M${xScale(0).toFixed(1)},${(PAD.top + cH).toFixed(1)} ` +
    pts.map((p, i) => `${xScale(i).toFixed(1)},${yScale(p.cash).toFixed(1)}`).join(' L') +
    ` L${xScale(n-1).toFixed(1)},${(PAD.top + cH).toFixed(1)} Z`;

  // Deployed area: from cash up to total
  const deployedAreaPath = pts.map((p, i) => `${xScale(i).toFixed(1)},${yScale(p.total_value).toFixed(1)}`).join(' L') +
    ' L' + pts.slice().reverse().map((p, i, arr) => `${xScale(n-1-i).toFixed(1)},${yScale(p.cash).toFixed(1)}`).join(' L') + ' Z';

  const initY = yScale(initCap).toFixed(1);

  // Y-axis ticks
  const tickCount = 5;
  const tickStep  = (maxV - minV) / tickCount;
  const ticks     = Array.from({ length: tickCount + 1 }, (_, i) => minV + i * tickStep);

  // X-axis labels (yearly)
  const years = [...new Set(pts.map((p) => p.date.slice(0, 4)))];

  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="${prefix}-grad-dep" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0d9488" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#0d9488" stop-opacity="0.25"/>
      </linearGradient>
      <linearGradient id="${prefix}-grad-cash" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#475569" stop-opacity="0.7"/>
        <stop offset="100%" stop-color="#475569" stop-opacity="0.2"/>
      </linearGradient>
    </defs>
    <!-- Cash area -->
    <path d="${cashAreaPath}" fill="url(#${prefix}-grad-cash)"/>
    <!-- Deployed area -->
    <path d="M${deployedAreaPath}" fill="url(#${prefix}-grad-dep)"/>
    <!-- Total value line -->
    <polyline points="${pts.map((p, i) => `${xScale(i).toFixed(1)},${yScale(p.total_value).toFixed(1)}`).join(' ')}"
      fill="none" stroke="#e2e8f0" stroke-width="1.5" stroke-linejoin="round"/>
    <!-- Initial capital reference line -->
    <line x1="${PAD.left}" y1="${initY}" x2="${(PAD.left + cW).toFixed(1)}" y2="${initY}"
      stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
    <text x="${(PAD.left + cW + 3).toFixed(1)}" y="${(parseFloat(initY) + 4).toFixed(1)}"
      font-size="9" fill="#64748b">₹1L</text>
    <!-- Y-axis ticks -->
    ${ticks.map((v) => `
    <line x1="${PAD.left - 4}" y1="${yScale(v).toFixed(1)}" x2="${PAD.left}" y2="${yScale(v).toFixed(1)}"
      stroke="var(--border)" stroke-width="1"/>
    <text x="${PAD.left - 6}" y="${(yScale(v) + 4).toFixed(1)}"
      font-size="10" fill="var(--muted)" text-anchor="end">₹${(v/1000).toFixed(0)}k</text>
    <line x1="${PAD.left}" y1="${yScale(v).toFixed(1)}" x2="${PAD.left + cW}" y2="${yScale(v).toFixed(1)}"
      stroke="var(--border)" stroke-width="0.4" opacity="0.5"/>`).join('')}
    <!-- X-axis year labels -->
    ${years.map((yr) => {
      const idx = pts.findIndex((p) => p.date.startsWith(yr));
      if (idx < 0) return '';
      const x = xScale(idx).toFixed(1);
      return `<text x="${x}" y="${(PAD.top + cH + 18).toFixed(1)}"
        font-size="10" fill="var(--muted)" text-anchor="middle">${yr}</text>`;
    }).join('')}
    <!-- Hover overlay -->
    <rect id="${prefix}-pb-hover-rect" x="${PAD.left}" y="${PAD.top}" width="${cW}" height="${cH}"
      fill="transparent" style="cursor:crosshair"/>
  `;

  // Hover interaction
  const hoverRect = el(`${prefix}-pb-hover-rect`);
  if (hoverRect && tip) {
    hoverRect.addEventListener('mousemove', (e) => {
      const rect   = ctr.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - PAD.left;
      const idx    = Math.max(0, Math.min(n - 1, Math.round(mouseX / cW * (n - 1))));
      const pt     = pts[idx];
      tip.style.display = 'block';
      tip.style.left    = `${Math.min(e.clientX - rect.left + 10, W - 180)}px`;
      tip.style.top     = `${e.clientY - rect.top - 10}px`;
      tip.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px">${pt.date}</div>
        <div>Total: <b>${fmtCur(pt.total_value)}</b></div>
        <div style="color:#0d9488">Deployed: ${fmtCur(pt.deployed)}</div>
        <div style="color:#94a3b8">Cash: ${fmtCur(pt.cash)}</div>
        <div style="color:var(--muted);font-size:0.78rem">Open positions: ${pt.open_count}</div>`;
    });
    hoverRect.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }
}

/* ── Init orchestrator ───────────────────────────────────────── */
function initPortfolioBacktest(prefix, data) {
  if (prefix === 'w52')  portfolioBacktest52w  = data;
  else                   portfolioBacktestS200 = data;

  renderPortfolioSummary(prefix, data.summary);
  renderPortfolioYearlyReturns(prefix, data.summary);
  renderPortfolioTierStats(prefix, data.summary);
  renderPortfolioTickerPills(prefix);
  renderPortfolioTradeLog(prefix);

  if (_pbInited[prefix]) return;  // filter events already wired — don't add duplicates
  _pbInited[prefix] = true;

  // Wire filter events (once per prefix)
  const search    = el(`${prefix}-pb-search`);
  const fStatus   = el(`${prefix}-pb-filter-status`);
  const fCap      = el(`${prefix}-pb-filter-cap`);
  const fTranche  = el(`${prefix}-pb-filter-tranche`);
  const fStrategy = el(`${prefix}-pb-filter-strategy`);

  const refresh = () => renderPortfolioTradeLog(prefix);

  search?.addEventListener('input',   (e) => { _pbFilters[prefix].search   = e.target.value; refresh(); });
  fStatus?.addEventListener('change',  (e) => { _pbFilters[prefix].status   = e.target.value; refresh(); });
  fCap?.addEventListener('change',     (e) => { _pbFilters[prefix].cap      = e.target.value; refresh(); });
  fTranche?.addEventListener('change', (e) => { _pbFilters[prefix].tranche  = e.target.value; refresh(); });
  fStrategy?.addEventListener('change',(e) => { _pbFilters[prefix].strategy = e.target.value; refresh(); });
}

/* ── Exit mode diff badge ─────────────────────────────────────── */
function updateExitModeDiffBadge() {
  if (!portfolioBacktest52wFixed || !portfolioBacktest52wRolling) return;
  const rollingBtn = document.querySelector('#f40-exit-mode-bar .exit-mode-btn[data-mode="rolling"]');
  if (rollingBtn) rollingBtn.disabled = false;
  const badge = el('f40-exit-diff');
  if (!badge) return;
  const diff = (portfolioBacktest52wRolling.summary?.cagr_pct ?? 0)
             - (portfolioBacktest52wFixed.summary?.cagr_pct ?? 0);
  badge.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}% CAGR`;
  badge.className = `exit-diff-badge ${diff >= 0 ? 'exit-diff-pos' : 'exit-diff-neg'}`;
  badge.style.display = '';
}

/* ── Envelope diff badges ─────────────────────────────────────── */
function updateEnvDiffBadge(envKey, dataset, badgeId, btnSelector) {
  if (!portfolioBacktest52wFixed || !dataset) return;
  const btn = document.querySelector(btnSelector);
  if (btn) btn.disabled = false;
  const badge = el(badgeId);
  if (!badge) return;
  const diff = (dataset.summary?.cagr_pct ?? 0)
             - (portfolioBacktest52wFixed.summary?.cagr_pct ?? 0);
  badge.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
  badge.className = `exit-diff-badge ${diff >= 0 ? 'exit-diff-pos' : 'exit-diff-neg'}`;
  badge.style.display = '';
}

/* ══════════════════════════════════════════════════════════════
   DATA LOADING  (two-phase for fast initial render)

   Phase 1 (~163 KB): loads the three tiny files needed to render
   the 52W scanner page immediately — done in ~50 ms on localhost.

   Phase 2 (~37 MB): all heavy files start fetching simultaneously
   in the background. Each is processed as soon as it resolves so
   the UI updates progressively without blocking Phase 1.
═══════════════════════════════════════════════════════════════ */
async function loadData() {
  // ── Phase 1: tiny files → render 52W scanner immediately ──────────────────
  try {
    const [sumR, rowsR, bt52wSumR] = await Promise.all([
      fetch('data/current_setup_summary.json'),
      fetch('data/current_setup.json'),
      fetch(hzUrl('backtest_52w_summary')),
    ]);

    const currentSummary = sumR.ok      ? await sumR.json()      : {};
    const currentRows    = rowsR.ok     ? await rowsR.json()     : [];
    const bt52wSummary   = bt52wSumR.ok ? await bt52wSumR.json() : {};

    const luEl = el('last-updated');
    if (luEl) luEl.textContent = `Updated: ${bt52wSummary.backtest_date || currentSummary.run_date || '—'}`;

    render52wSummary(bt52wSummary);

    // ── Opportunity Scanner ──────────────────────────────────────────────────
    scannerRows = currentRows || [];

    document.querySelectorAll('.w52-sfb').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.w52-sfb').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        w52StatusFilter = btn.dataset.status;
        filterSortScanner();
      });
    });

    populateSectorFilter(scannerRows, 'scanner-sector', 'slp-sector-filter');
    filterSortScanner();

    el('scanner-search')?.addEventListener('input', filterSortScanner);
    el('scanner-sector')?.addEventListener('change', filterSortScanner);
    el('scanner-cap')?.addEventListener('change', filterSortScanner);
    el('scanner-sort')?.addEventListener('change', filterSortScanner);

  } catch (err) {
    el('main-wrapper').innerHTML = `
      <div style="padding:3rem;text-align:center;color:var(--muted)">
        <h2 style="color:var(--red);margin-bottom:1rem">Data not loaded</h2>
        <p style="max-width:480px;margin:0 auto;line-height:1.6">${err.message}</p>
        <p style="margin-top:1rem;font-size:0.82rem">Run <code>f40_backtest_52w.py</code> then <code>build_data.py</code> and refresh.</p>
      </div>`;
    console.error(err);
    return;
  }

  // ── Phase 2: fire all heavy fetches simultaneously, process as each resolves
  // All network requests start NOW — none of these awaits blocks the others.
  const envLongP     = fetch('data/env_pb_long.json');
  const envLowerP    = fetch('data/env_pb_lower.json');
  const envUpperP    = fetch('data/env_pb_upper.json');
  const envCombinedP = fetch('data/env_pb_combined.json');

  const bt52wStkP  = fetch(hzUrl('backtest_52w_stock_data'));
  const rallyP     = fetch('data/s200_20pct_rallies.json');
  const s200StkP   = fetch('data/s200_stock_data.json');
  const s200BtSumP = fetch(hzUrl('s200_backtest_summary'));
  const s200BtStkP = fetch(hzUrl('s200_backtest_stock_data'));
  const pb52wP            = fetch(hzUrl('f40_portfolio_backtest_fixed'));
  const pb52wRollingP     = fetch(hzUrl('f40_portfolio_backtest_rolling'));
  const pb52wEnvLongP     = fetch(hzUrl('f40_portfolio_backtest_fixed_env-long'));
  const pb52wRallyF40P    = fetch(hzUrl('f40_portfolio_backtest_fixed_rally-f40'));
  const pb52wAllCombinedP = fetch(hzUrl('f40_portfolio_backtest_fixed_env-long_rally-f40'));
  const pbS200P           = fetch(hzUrl('s200_portfolio_backtest'));

  // ── Stock list state (module-scope vars _overview, _stockData, _currentTicker used) ──
  el('slp-sector-filter')?.addEventListener('change', (e) => { _slpSector = e.target.value; _refreshStockList(); });
  el('slp-search')?.addEventListener('input', (e) => { _slpSearch = e.target.value; _refreshStockList(); });
  el('slp-cap-filter')?.addEventListener('change', (e) => { _slpCap = e.target.value; _refreshStockList(); });
  el('slp-opportunity-filter')?.addEventListener('change', (e) => { _slpOpportunity = e.target.value; _refreshStockList(); });

  // S200 rally scanner (124 KB — resolves quickly)
  (async () => {
    try {
      const r = await rallyP;
      if (r.ok) {
        initRallyScanner(await r.json());
      } else {
        const card = el('rally-card');
        if (card) card.innerHTML = `
          <div class="coming-soon-card" style="margin:0">
            <div class="cs-icon">&#9651;</div>
            <h2>Scanner not run yet</h2>
            <p>Run <code>s200_20pct_rally_scanner.py</code> then <code>build_data.py</code> and refresh.</p>
          </div>`;
      }
    } catch (e) { console.warn('S200 rally scanner load failed:', e); }
  })();

  // S200 backtest summary + stock data (~2.8 MB combined)
  (async () => {
    try {
      const [sumR, stkR] = await Promise.all([s200BtSumP, s200BtStkP]);
      if (sumR.ok) initS200AggBacktest(await sumR.json());
      if (stkR.ok) { const d = await stkR.json(); s200BacktestStockData = d.stock_data || {}; }
    } catch (e) { console.warn('S200 backtest data load failed:', e); }
  })();

  // S200 stock analysis data (15 MB)
  (async () => {
    try {
      const r = await s200StkP;
      if (r.ok) initS200StockAnalysis(await r.json());
    } catch (e) { console.warn('S200 stock data load failed:', e); }
  })();

  // 52W stock data (22 MB) — updates stock list & detail when ready
  (async () => {
    try {
      const r = await bt52wStkP;
      if (r.ok) {
        const d = await r.json();
        _overview = d.overview  || [];
        _stockData = d.stock_data || {};
        _currentTicker = _overview[0]?.ticker;
        _refreshStockList();
        if (_currentTicker) renderStockDetail(_stockData, _currentTicker);
      }
    } catch (e) { console.warn('52W stock data load failed:', e); }
  })();

  // F40 portfolio backtest — fixed exit (loads first, renders immediately as default)
  (async () => {
    try {
      const r = await pb52wP;
      if (r.ok) {
        portfolioBacktest52wFixed = await r.json();
        initPortfolioBacktest('w52', portfolioBacktest52wFixed);
        updateExitModeDiffBadge();
      }
    } catch (e) { console.warn('F40 portfolio backtest (fixed) load failed:', e); }
  })();

  // F40 portfolio backtest — rolling ratchet (enables toggle once loaded)
  (async () => {
    try {
      const r = await pb52wRollingP;
      if (r.ok) {
        portfolioBacktest52wRolling = await r.json();
        updateExitModeDiffBadge();
      }
    } catch (e) { console.warn('F40 portfolio backtest (rolling) load failed:', e); }
  })();

  // F40 portfolio backtest — envelope (enables button when data arrives)
  (async () => {
    try {
      const r = await pb52wEnvLongP;
      if (r.ok) {
        portfolioBacktest52wEnvLong = await r.json();
        updateEnvDiffBadge('long', portfolioBacktest52wEnvLong, 'f40-env-diff-long',
          '#f40-exit-mode-bar .env-btn[data-env="long"]');
      }
    } catch (e) { console.warn('F40 portfolio backtest (env-long) load failed:', e); }
  })();

  // F40 portfolio backtest — 20% rally on F40 stocks
  (async () => {
    try {
      const r = await pb52wRallyF40P;
      if (r.ok) {
        portfolioBacktest52wRallyF40 = await r.json();
        updateEnvDiffBadge('rally-f40', portfolioBacktest52wRallyF40, 'f40-rally-diff',
          '#f40-exit-mode-bar .env-btn[data-env="rally-f40"]');
      }
    } catch (e) { console.warn('F40 portfolio backtest (rally-f40) load failed:', e); }
  })();

  // F40 portfolio backtest — all 3 combined (52W + Envelope + Rally)
  (async () => {
    try {
      const r = await pb52wAllCombinedP;
      if (r.ok) {
        portfolioBacktest52wAllCombined = await r.json();
        updateEnvDiffBadge('all', portfolioBacktest52wAllCombined, 'f40-all3-diff',
          '#f40-exit-mode-bar .env-btn[data-env="all"]');
      }
    } catch (e) { console.warn('F40 portfolio backtest (all-combined) load failed:', e); }
  })();

  (async () => {
    try {
      const r = await pbS200P;
      if (r.ok) initPortfolioBacktest('s200', await r.json());
    } catch (e) { console.warn('S200 portfolio backtest load failed:', e); }
  })();

  // Envelope strategy portfolio backtests
  for (const [mode, promise] of [['long', envLongP], ['lower', envLowerP], ['upper', envUpperP], ['combined', envCombinedP]]) {
    (async (m, p) => {
      try {
        const r = await p;
        if (r.ok) {
          initEnvData(m, await r.json());
        } else if (m === 'long') {
          const em1 = el('env-pb-empty'),  em2 = el('env-tradelog-empty');
          if (em1) em1.style.display = 'block';
          if (em2) em2.style.display = 'block';
        }
      } catch (e) { console.warn(`Envelope ${m} load failed:`, e); }
    })(mode, promise);
  }
}

/* ══════════════════════════════════════════════════════════════
   ENVELOPE STRATEGY TAB
═══════════════════════════════════════════════════════════════ */

// Dataset store: keyed by mode (long | lower | upper | combined)
const _envData   = { long: null, lower: null, upper: null, combined: null };
let   _envMode   = 'long';      // currently displayed mode
let   _envActive = null;        // currently displayed dataset
let   _envSelectedTrade = null; // trade row highlighted for chart
let   _envInited = false;       // filter event listeners wired once
const _envFilters = { search: '', status: 'ALL', cap: 'ALL', strategy: 'ALL', ticker: null };

// Sub-tab: backtest | tradelog | scanner | stockanalysis
document.querySelectorAll('.env-subtab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.env-subtab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.env-subtab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    el(`envtab-${btn.dataset.envtab}`)?.classList.add('active');
    if (btn.dataset.envtab === 'backtest')       drawEnvPortfolioChart();
    if (btn.dataset.envtab === 'scanner')        renderEnvScanner();
    if (btn.dataset.envtab === 'stockanalysis')  renderEnvStockAnalysis();
  });
});
window.addEventListener('resize', () => {
  if (el('page-envelope')?.classList.contains('active')) drawEnvPortfolioChart();
});

// Strategy selector
document.querySelectorAll('#env-strategy-bar .exit-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    _envMode = btn.dataset.envmode;
    document.querySelectorAll('#env-strategy-bar .exit-mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    _envActive = _envData[_envMode];
    if (_envActive) renderEnvTab();
    drawEnvPortfolioChart();
  });
});

/* ── Parameter panel: exit mode toggle & run button ──────── */
let _envExitMode = 'fixed';

document.getElementById('ep-exit-toggle')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-epmode]');
  if (!btn) return;
  _envExitMode = btn.dataset.epmode;
  btn.parentElement.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('active', b === btn)
  );
});

document.getElementById('ep-run-btn')?.addEventListener('click', runEnvBacktest);

// ── Grid Search ───────────────────────────────────────────────────────────────

document.getElementById('ep-grid-toggle-btn')?.addEventListener('click', () => {
  const panel = document.getElementById('ep-grid-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('ep-grid-btn')?.addEventListener('click', runEnvGridSearch);
document.getElementById('ep-grid-stop-btn')?.addEventListener('click', stopEnvGridSearch);

let _gridES = null;         // active EventSource
let _gridResults = [];      // all results received so far

function _gsVal(id) { return document.getElementById(id)?.value || ''; }

function runEnvGridSearch() {
  const btn     = document.getElementById('ep-grid-btn');
  const stopBtn = document.getElementById('ep-grid-stop-btn');
  const status  = document.getElementById('ep-grid-status');

  if (_gridES) { _gridES.close(); _gridES = null; }
  _gridResults = [];

  // Show progress UI
  const progWrap  = document.getElementById('ep-grid-progress-wrap');
  const tableWrap = document.getElementById('ep-grid-table-wrap');
  const bestDiv   = document.getElementById('ep-grid-best');
  if (progWrap)  progWrap.style.display  = 'block';
  if (tableWrap) tableWrap.style.display = 'block';
  if (bestDiv)   bestDiv.style.display   = 'none';
  document.getElementById('ep-grid-tbody').innerHTML = '';
  document.getElementById('ep-grid-prog-bar').style.width = '0%';
  document.getElementById('ep-grid-prog-label').textContent = '0 / ? combos';
  document.getElementById('ep-grid-eta').textContent = '';

  if (btn)     btn.style.display     = 'none';
  if (stopBtn) stopBtn.style.display = 'inline-block';
  if (status)  status.textContent    = 'Connecting…';

  // Build query string from UI inputs
  const params = new URLSearchParams({
    env_pcts:    _gsVal('gs-env-pcts'),
    zone_pcts:   _gsVal('gs-zone-pcts'),
    alloc_large: _gsVal('gs-alloc-large'),
    alloc_mid:   _gsVal('gs-alloc-mid'),
    alloc_small: _gsVal('gs-alloc-small'),
    exit_modes:  _gsVal('gs-exit-modes'),
    pyramid:     _gsVal('gs-pyramid'),
  });

  _gridES = new EventSource(`/api/envelope/grid-search?${params}`);

  _gridES.onmessage = (e) => {
    const d = JSON.parse(e.data);

    if (d.event === 'status') {
      if (status) status.textContent = d.msg;
      return;
    }
    if (d.event === 'error') {
      if (status) status.textContent = 'Error: ' + d.msg;
      _gridDone();
      return;
    }
    if (d.event === 'complete') {
      _gridResults = d.top10 || _gridResults;
      if (status) status.textContent = `Done — ${d.done}/${d.total} combos  ·  Best CAGR: ${(_gridResults[0]?.cagr || 0).toFixed(2)}%`;
      _gridUpdateTable(_gridResults.slice(0, 10));
      _gridDone();
      return;
    }

    // Normal result row
    _gridResults.push(d);
    _gridResults.sort((a, b) => b.cagr - a.cagr);

    const pct = d.total > 0 ? (d.done / d.total * 100).toFixed(1) : 0;
    document.getElementById('ep-grid-prog-bar').style.width = pct + '%';
    document.getElementById('ep-grid-prog-label').textContent = `${d.done} / ${d.total} combos (${pct}%)`;
    document.getElementById('ep-grid-eta').textContent = `ETA ~${d.eta_min} min`;

    if (status) status.textContent = `Running — this: ${d.cagr.toFixed(2)}%  best: ${d.best_cagr.toFixed(2)}%`;

    // Update best-so-far
    const bestDiv = document.getElementById('ep-grid-best');
    const bestTxt = document.getElementById('ep-grid-best-text');
    if (bestDiv && bestTxt) {
      bestDiv.style.display = 'block';
      const pyr = d.best_pyramid ? 'Pyr' : 'NoPyr';
      bestTxt.textContent = `CAGR ${d.best_cagr.toFixed(2)}%  |  Env=${d.best_env_pct}%  Zone=${d.best_zone_pct}%  `
        + `L=${d.best_alloc_large}% M=${d.best_alloc_mid}% S=${d.best_alloc_small}%  `
        + `${d.best_exit_mode}  ${pyr}`;
    }

    // Refresh top-10 table every 10 results to avoid DOM thrash
    if (_gridResults.length <= 20 || _gridResults.length % 10 === 0) {
      _gridUpdateTable(_gridResults.slice(0, 10));
    }
  };

  _gridES.onerror = () => {
    if (status) status.textContent = 'Connection lost.';
    _gridDone();
  };
}

function stopEnvGridSearch() {
  if (_gridES) { _gridES.close(); _gridES = null; }
  fetch('/api/envelope/grid-search/stop', { method: 'POST' }).catch(() => {});
  document.getElementById('ep-grid-status').textContent = 'Stopped.';
  _gridDone();
}

function _gridDone() {
  const btn     = document.getElementById('ep-grid-btn');
  const stopBtn = document.getElementById('ep-grid-stop-btn');
  if (btn)     btn.style.display     = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'none';
  _gridES = null;
}

function _gridUpdateTable(rows) {
  const tbody = document.getElementById('ep-grid-tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map((r, i) => {
    const pyr = r.pyramid ? 'Y' : 'N';
    const bg  = i === 0 ? 'background:#0d2a1a' : '';
    return `<tr style="border-bottom:1px solid #1a2a4a;${bg}">
      <td style="padding:3px 6px;text-align:right;color:#8899aa">${i + 1}</td>
      <td style="padding:3px 6px;text-align:right;color:#4fc3f7;font-weight:bold">${r.cagr.toFixed(2)}%</td>
      <td style="padding:3px 6px;text-align:right">${r.env_pct}</td>
      <td style="padding:3px 6px;text-align:right">${r.zone_pct}</td>
      <td style="padding:3px 6px;text-align:right">${r.alloc_large}</td>
      <td style="padding:3px 6px;text-align:right">${r.alloc_mid}</td>
      <td style="padding:3px 6px;text-align:right">${r.alloc_small}</td>
      <td style="padding:3px 6px">${r.exit_mode}</td>
      <td style="padding:3px 6px">${pyr}</td>
      <td style="padding:3px 6px;text-align:right">${r.trades}</td>
      <td style="padding:3px 6px;text-align:right">${r.win_rate.toFixed(1)}</td>
      <td style="padding:3px 6px;text-align:right;color:#ff8888">${r.max_dd.toFixed(1)}</td>
    </tr>`;
  }).join('');
}

async function runEnvBacktest() {
  const runBtn  = document.getElementById('ep-run-btn');
  const loading = document.getElementById('ep-loading');
  if (!runBtn) return;
  runBtn.disabled = true;
  if (loading) loading.style.display = 'inline';

  const params = {
    env_pct:     parseFloat(document.getElementById('ep-env-pct')?.value)     || 14,
    alloc_large: parseFloat(document.getElementById('ep-alloc-large')?.value) || 3,
    alloc_mid:   parseFloat(document.getElementById('ep-alloc-mid')?.value)   || 2,
    alloc_small: parseFloat(document.getElementById('ep-alloc-small')?.value) || 1,
    entry_band:  parseFloat(document.getElementById('ep-band')?.value)        || 1,
    exit_mode:   _envExitMode,
    pyramid:     document.getElementById('ep-pyramid')?.checked || false,
  };

  try {
    const res = await fetch('/api/envelope_backtest', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }
    const data = await res.json();
    // Store result as the 'long' dataset and switch to it
    _envData['long'] = data;
    _envMode   = 'long';
    _envActive = data;
    // Highlight the Long Full strategy button
    document.querySelectorAll('#env-strategy-bar .exit-mode-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.envmode === 'long')
    );
    renderEnvTab();
    drawEnvPortfolioChart();
    updateEnvDiffBadges();
    // Show last-run result badge on param panel
    const m = data.meta || {}, s = data.summary || {};
    const exitLabel = m.exit_mode === 'rolling' ? 'Rolling' : 'Fixed';
    const pyrLabel  = m.pyramid ? ' + Pyramid' : '';
    const badge = el('ep-last-run');
    if (badge) {
      badge.innerHTML = `&#10003; env=${m.envelope_pct}% &nbsp;|&nbsp; ${exitLabel}${pyrLabel} &nbsp;|&nbsp; <strong>CAGR ${s.cagr_pct}%</strong> &nbsp;|&nbsp; ${s.total_trades} trades &nbsp;|&nbsp; Win ${s.win_rate_pct}%`;
      badge.style.display = 'inline';
    }
  } catch (err) {
    alert('Backtest failed:\n' + err.message);
  } finally {
    runBtn.disabled = false;
    if (loading) loading.style.display = 'none';
  }
}

/* ── Strategy description ─────────────────────────────────── */
const ENV_MODE_DESCS = {
  long:     { label: 'Long Full',   color: '#22c55e', desc: 'Buy at lower envelope (MA−14%)&nbsp;·&nbsp;Sell at upper envelope (MA+14%)' },
  lower:    { label: 'Lower Half',  color: '#38bdf8', desc: 'Buy at lower envelope (MA−14%)&nbsp;·&nbsp;Sell at 200 DMA (MA)' },
  upper:    { label: 'Upper Half',  color: '#f59e0b', desc: 'Buy at 200 DMA when rising from below&nbsp;·&nbsp;Sell at upper envelope (MA+14%)' },
  combined: { label: 'All Combined', color: '#a78bfa', desc: 'Long Full + Lower Half + Upper Half running simultaneously in shared cash pool' },
};

function updateEnvModeDesc() {
  const d   = ENV_MODE_DESCS[_envMode];
  const box = el('env-mode-desc');
  if (!box || !d) return;
  // Use actual envelope % from loaded data (reflects API runs with custom params)
  const ep = _envActive?.meta?.envelope_pct ?? 14;
  const desc = d.desc.replace(/\d+(?:\.\d+)?%/g, `${ep}%`);
  box.innerHTML = `<div style="display:inline-flex;align-items:center;gap:0.6rem;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:6px;padding:0.45rem 0.85rem;font-size:0.8rem">
    <span style="color:${d.color};font-weight:600">${d.label}</span>
    <span style="color:var(--muted)">·</span>
    <span style="color:var(--muted)">${desc}</span>
  </div>`;
}

/* ── Metric cards ─────────────────────────────────────────── */
function renderEnvSummary() {
  const data = _envActive;
  if (!data) return;
  const s = data.summary || {};
  buildMetricCards(el('env-metric-row'), [
    { label: 'CAGR',           value: fmtPct(s.cagr_pct),             cls: (s.cagr_pct || 0) >= 0 ? 'green' : 'red' },
    { label: 'Total Return',   value: fmtPct(s.total_return_pct),      cls: (s.total_return_pct || 0) >= 0 ? 'green' : 'red' },
    { label: 'Win Rate',       value: fmtPct(s.win_rate_pct),          cls: (s.win_rate_pct || 0) >= 50 ? 'green' : 'amber',
      sub: `${s.wins ?? 0} wins / ${s.total_trades ?? 0} closed` },
    { label: 'Avg Trade P/L',  value: fmtPct(s.avg_trade_pnl_pct),     cls: (s.avg_trade_pnl_pct || 0) >= 0 ? 'green' : 'red' },
    { label: 'Avg Duration',   value: s.avg_trade_duration_days ? `${Math.round(s.avg_trade_duration_days)}d` : '—' },
    { label: 'Max Drawdown',   value: s.max_drawdown_pct != null ? `-${fmt(s.max_drawdown_pct)}%` : '—', cls: 'red' },
    { label: 'Open at End',    value: s.open_at_end ?? '—' },
    { label: 'Time in Market', value: s.time_in_market_pct != null ? `${fmt(s.time_in_market_pct, 1)}%` : '—' },
  ]);

  // Metric row in backtest sub-tab
  buildMetricCards(el('env-pb-metric-row'), [
    { label: 'Total Return',       value: fmtPct(s.total_return_pct),      cls: (s.total_return_pct || 0) >= 0 ? 'green' : 'red' },
    { label: 'CAGR / XIRR',       value: fmtPct(s.cagr_pct),              cls: (s.cagr_pct || 0) >= 0 ? 'green' : 'red',
      sub: s.xirr_pct != null ? `XIRR ${fmtPct(s.xirr_pct)}` : '' },
    { label: 'Final Value',        value: fmtCur(s.final_value),           cls: 'accent' },
    { label: 'Win Rate',           value: fmtPct(s.win_rate_pct),          cls: (s.win_rate_pct || 0) >= 50 ? 'green' : 'amber',
      sub: `${s.wins ?? 0} wins / ${s.total_trades ?? 0} closed` },
    { label: 'Avg Trade Duration', value: s.avg_trade_duration_days ? `${Math.round(s.avg_trade_duration_days)}d` : '—' },
    { label: 'Avg Trade P/L',      value: fmtPct(s.avg_trade_pnl_pct),     cls: (s.avg_trade_pnl_pct || 0) >= 0 ? 'green' : 'red' },
    { label: 'Max Drawdown',       value: s.max_drawdown_pct != null ? `-${fmt(s.max_drawdown_pct)}%` : '—', cls: 'red' },
    { label: 'Time in Market',     value: s.time_in_market_pct != null ? `${fmt(s.time_in_market_pct, 1)}%` : '—' },
    { label: 'Open at End',        value: s.open_at_end ?? '—' },
  ]);
}

/* ── Yearly returns ───────────────────────────────────────── */
function renderEnvYearlyReturns() {
  const wrap = el('env-pb-yearly-wrap');
  const s    = _envActive?.summary;
  if (!wrap || !s?.yearly_returns) return;
  const yr   = s.yearly_returns;
  const years = Object.keys(yr).sort();
  if (!years.length) { wrap.innerHTML = ''; return; }
  const maxAbs = Math.max(1, ...years.map((y) => Math.abs(yr[y])));
  const rows = years.map((y) => {
    const v = yr[y], pos = v >= 0;
    const pct = Math.min(100, Math.abs(v) / maxAbs * 100);
    return `<tr>
      <td style="color:var(--muted);width:4rem">${y}</td>
      <td style="width:6rem;font-weight:600;color:var(--${pos ? 'green' : 'red'})">${fmtPct(v)}</td>
      <td><div style="height:10px;border-radius:3px;width:${pct}%;background:var(--${pos ? 'green' : 'red'});opacity:0.7"></div></td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table style="width:100%;border-collapse:collapse"><tbody>${rows}</tbody></table>`;
}

/* ── Cap tier stats ───────────────────────────────────────── */
function renderEnvTierStats() {
  const row = el('env-pb-tier-row');
  const s   = _envActive?.summary;
  if (!row || !s?.by_cap_tier) return;
  const cards = [];
  for (const [tier, data] of Object.entries(s.by_cap_tier)) {
    if (!data.count) continue;
    cards.push({
      label: tier,
      value: fmtPct(data.win_rate_pct),
      cls: (data.win_rate_pct || 0) >= 50 ? 'green' : 'amber',
      sub: `${data.wins}/${data.count} · avg ${fmtPct(data.avg_pnl_pct)}`,
    });
  }
  buildMetricCards(row, cards);
}

/* ── Equity curve chart ───────────────────────────────────── */
function drawEnvPortfolioChart() {
  const data = _envActive;
  const svg  = el('env-pb-chart');
  const tip  = el('env-pb-tooltip');
  const ctr  = el('env-pb-chart-container');
  if (!svg || !ctr) return;
  if (!data?.equity_curve?.length) { svg.innerHTML = ''; return; }

  const curve = data.equity_curve;
  const W = ctr.clientWidth  || 800;
  const H = ctr.clientHeight || 320;
  const PAD = { top: 16, right: 20, bottom: 30, left: 64 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  const step = Math.max(1, Math.floor(curve.length / 600));
  const pts  = curve.filter((_, i) => i % step === 0);
  if (pts[pts.length - 1] !== curve[curve.length - 1]) pts.push(curve[curve.length - 1]);

  const n        = pts.length;
  const allTotal = pts.map((p) => p.total_value);
  const minV     = Math.min(...allTotal) * 0.97;
  const maxV     = Math.max(...allTotal) * 1.03;
  const initCap  = data.meta?.initial_capital || 100000;

  const xS = (i) => PAD.left + (i / (n - 1)) * cW;
  const yS = (v) => PAD.top  + cH - ((v - minV) / (maxV - minV || 1)) * cH;

  const cashAreaPath = `M${xS(0).toFixed(1)},${(PAD.top + cH).toFixed(1)} ` +
    pts.map((p, i) => `${xS(i).toFixed(1)},${yS(p.cash).toFixed(1)}`).join(' L') +
    ` L${xS(n - 1).toFixed(1)},${(PAD.top + cH).toFixed(1)} Z`;

  const deployedAreaPath = pts.map((p, i) => `${xS(i).toFixed(1)},${yS(p.total_value).toFixed(1)}`).join(' L') +
    ' L' + pts.slice().reverse().map((p, i) => `${xS(n - 1 - i).toFixed(1)},${yS(p.cash).toFixed(1)}`).join(' L') + ' Z';

  const initY = yS(initCap).toFixed(1);
  const ticks = Array.from({ length: 6 }, (_, i) => minV + i * (maxV - minV) / 5);
  const years = [...new Set(pts.map((p) => p.date.slice(0, 4)))];

  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="env-grad-dep" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0d9488" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#0d9488" stop-opacity="0.25"/>
      </linearGradient>
      <linearGradient id="env-grad-cash" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#475569" stop-opacity="0.7"/>
        <stop offset="100%" stop-color="#475569" stop-opacity="0.2"/>
      </linearGradient>
    </defs>
    <path d="${cashAreaPath}" fill="url(#env-grad-cash)"/>
    <path d="M${deployedAreaPath}" fill="url(#env-grad-dep)"/>
    <polyline points="${pts.map((p, i) => `${xS(i).toFixed(1)},${yS(p.total_value).toFixed(1)}`).join(' ')}"
      fill="none" stroke="#e2e8f0" stroke-width="1.5" stroke-linejoin="round"/>
    <line x1="${PAD.left}" y1="${initY}" x2="${(PAD.left + cW).toFixed(1)}" y2="${initY}"
      stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
    <text x="${(PAD.left + cW + 3).toFixed(1)}" y="${(parseFloat(initY) + 4).toFixed(1)}"
      font-size="9" fill="#64748b">₹1L</text>
    ${ticks.map((v) => `
    <line x1="${PAD.left - 4}" y1="${yS(v).toFixed(1)}" x2="${PAD.left}" y2="${yS(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
    <text x="${PAD.left - 6}" y="${(yS(v) + 4).toFixed(1)}" font-size="10" fill="var(--muted)" text-anchor="end">₹${(v / 1000).toFixed(0)}k</text>
    <line x1="${PAD.left}" y1="${yS(v).toFixed(1)}" x2="${PAD.left + cW}" y2="${yS(v).toFixed(1)}" stroke="var(--border)" stroke-width="0.4" opacity="0.5"/>`).join('')}
    ${years.map((yr) => {
      const idx = pts.findIndex((p) => p.date.startsWith(yr));
      if (idx < 0) return '';
      return `<text x="${xS(idx).toFixed(1)}" y="${(PAD.top + cH + 18).toFixed(1)}"
        font-size="10" fill="var(--muted)" text-anchor="middle">${yr}</text>`;
    }).join('')}
    <rect id="env-pb-hover-rect" x="${PAD.left}" y="${PAD.top}" width="${cW}" height="${cH}"
      fill="transparent" style="cursor:crosshair"/>
  `;

  const hr = el('env-pb-hover-rect');
  if (hr && tip) {
    hr.addEventListener('mousemove', (e) => {
      const rect  = ctr.getBoundingClientRect();
      const idx   = Math.max(0, Math.min(n - 1, Math.round((e.clientX - rect.left - PAD.left) / cW * (n - 1))));
      const pt    = pts[idx];
      tip.style.display = 'block';
      tip.style.left = `${Math.min(e.clientX - rect.left + 10, W - 180)}px`;
      tip.style.top  = `${e.clientY - rect.top - 10}px`;
      tip.innerHTML  = `
        <div style="font-weight:600;margin-bottom:4px">${pt.date}</div>
        <div>Total: <b>${fmtCur(pt.total_value)}</b></div>
        <div style="color:#0d9488">Deployed: ${fmtCur(pt.deployed)}</div>
        <div style="color:#94a3b8">Cash: ${fmtCur(pt.cash)}</div>
        <div style="color:var(--muted);font-size:0.78rem">Open positions: ${pt.open_count}</div>`;
    });
    hr.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }
}

/* ── Ticker pills ─────────────────────────────────────────── */
function renderEnvTickerPills() {
  const container = el('env-pb-ticker-pills');
  const trades    = _envActive?.trades || [];
  if (!container) return;
  const tickers = [...new Set(trades.map((t) => t.ticker))].sort();
  const active  = _envFilters.ticker;
  container.innerHTML = '';

  const mkPill = (label, ticker) => {
    const isActive = ticker === active;
    const btn = document.createElement('button');
    btn.className = `ticker-pill${ticker === null ? ' all-pill' : ''}${isActive || (ticker === null && active === null) ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      _envFilters.ticker = (ticker === active) ? null : ticker;
      _envSelectedTrade = null;
      closeEnvTradePanel();
      renderEnvTickerPills();
      renderEnvTradeLog();
    });
    container.appendChild(btn);
  };

  mkPill('All', null);
  tickers.forEach((t) => mkPill(t, t));
}

/* ── Trade log ────────────────────────────────────────────── */
const ENV_STRATEGY_COLORS = {
  LONG_FULL:   '#22c55e',
  LOWER_HALF:  '#38bdf8',
  UPPER_HALF:  '#f59e0b',
};

function renderEnvTradeLog() {
  const body  = el('env-pb-trade-body');
  const empty = el('env-tradelog-empty');
  const trades = _envActive?.trades || [];
  if (!body) return;

  if (!trades.length) {
    body.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const f        = _envFilters;
  const search   = (f.search   || '').toLowerCase();
  const fStatus  = f.status   || 'ALL';
  const fCap     = f.cap      || 'ALL';
  const fStrat   = f.strategy || 'ALL';
  const fTicker  = f.ticker   || null;

  const filtered = trades.filter((t) => {
    if (search  && !t.ticker.toLowerCase().includes(search)) return false;
    if (fStatus !== 'ALL' && t.exit_reason !== fStatus)      return false;
    if (fCap    !== 'ALL' && t.cap_tier    !== fCap)         return false;
    if (fStrat  !== 'ALL' && t.strategy    !== fStrat)       return false;
    if (fTicker && t.ticker !== fTicker)                     return false;
    return true;
  });

  body.innerHTML = '';
  filtered.forEach((t, i) => {
    const outcome = t.exit_reason === 'ENV_EXIT'
      ? `<span class="exit-badge" style="background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.3)">ENV EXIT</span>`
      : t.exit_reason === 'MA_EXIT'
      ? `<span class="exit-badge" style="background:rgba(56,189,248,0.15);color:var(--accent);border-color:rgba(56,189,248,0.3)">MA EXIT</span>`
      : `<span class="exit-badge" style="background:rgba(148,163,184,0.12);color:var(--muted)">OPEN</span>`;

    const stColor = ENV_STRATEGY_COLORS[t.strategy] || 'var(--muted)';
    const stLabel = { LONG_FULL: 'Long↑', LOWER_HALF: 'Lower½', UPPER_HALF: 'Upper½' }[t.strategy] || t.strategy;

    const pnlCls = (t.pnl_pct || 0) >= 0 ? 'pnl-pos' : 'pnl-neg';
    const ddCls  = (t.max_drawdown_pct || 0) < -10 ? 'pnl-neg' : '';
    const isSelected = _envSelectedTrade?.trade_id === t.trade_id;

    body.insertAdjacentHTML('beforeend', `<tr data-trade-id="${t.trade_id}" class="${isSelected ? 'selected' : ''}">
      <td style="color:var(--muted)">${i + 1}</td>
      <td style="font-weight:600">${t.ticker}</td>
      <td><span class="cap-badge ${capCls(t.cap_tier)}">${t.cap_tier?.replace(' Cap', '') || '—'}</span></td>
      <td><span style="font-size:0.78rem;font-weight:600;color:${stColor}">${stLabel}</span></td>
      <td style="color:var(--muted);font-size:0.8rem">${t.entry_date ?? '—'}</td>
      <td>${fmtCur(t.entry_price)}</td>
      <td style="color:var(--accent)">${fmtCur(t.exit_target)}</td>
      <td style="color:var(--muted);font-size:0.8rem">${t.exit_date ?? '—'}</td>
      <td>${t.exit_price != null ? fmtCur(t.exit_price) : '—'}</td>
      <td style="color:var(--muted)">${t.trade_duration_days != null ? t.trade_duration_days + 'd' : '—'}</td>
      <td class="${pnlCls}">${t.pnl_pct != null ? fmtPct(t.pnl_pct) : '—'}</td>
      <td class="${pnlCls}">${t.pnl != null ? fmtCur(t.pnl) : '—'}</td>
      <td class="${ddCls}" style="font-size:0.8rem">${t.max_drawdown_pct != null ? fmtPct(t.max_drawdown_pct) : '—'}</td>
      <td>${outcome}</td>
    </tr>`);
  });

  body.onclick = (e) => {
    const row = e.target.closest('tr[data-trade-id]');
    if (!row) return;
    const trade = (_envActive?.trades || []).find((t) => t.trade_id === row.dataset.tradeId);
    if (!trade) return;
    if (_envSelectedTrade?.trade_id === trade.trade_id) {
      _envSelectedTrade = null;
      closeEnvTradePanel();
      renderEnvTradeLog();
      return;
    }
    _envSelectedTrade = trade;
    renderEnvTradeLog();
    showEnvTradeChart(trade);
  };
}

/* ── Trade detail chart ───────────────────────────────────── */
function closeEnvTradePanel() {
  const panel = el('env-pb-trade-panel');
  if (panel) panel.style.display = 'none';
}

function showEnvTradeChart(trade) {
  const panel = el('env-pb-trade-panel');
  const title = el('env-pb-trade-panel-title');
  const svg   = el('env-pb-trade-chart');
  const ctr   = el('env-pb-trade-chart-container');
  const tip   = el('env-pb-trade-chart-tip');
  if (!panel || !svg || !ctr) return;

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const allPrices = _envActive?.stock_prices?.[trade.ticker] || [];
  if (!allPrices.length) {
    if (title) title.textContent = `${trade.ticker} — no price data available`;
    svg.innerHTML = '';
    return;
  }

  const isOpen    = trade.exit_reason === 'OPEN';
  const lastDate  = allPrices[allPrices.length - 1].date;
  const exitDate  = isOpen ? lastDate : (trade.exit_date ?? lastDate);
  const entryIdx  = allPrices.findIndex((p) => p.date >= trade.entry_date);
  const exitIdx   = allPrices.findIndex((p) => p.date >= exitDate);
  const CTX       = 30;
  const startIdx  = Math.max(0, entryIdx - CTX);
  const endIdx    = Math.min(allPrices.length - 1, (exitIdx < 0 ? allPrices.length - 1 : exitIdx) + CTX);
  const prices    = allPrices.slice(startIdx, endIdx + 1);
  if (!prices.length) { panel.style.display = 'none'; return; }

  const stColor = ENV_STRATEGY_COLORS[trade.strategy] || '#94a3b8';
  const pnlStr  = trade.pnl_pct != null ? `<span class="${trade.pnl_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmtPct(trade.pnl_pct)}</span>` : '';
  if (title) {
    title.innerHTML =
      `<span style="color:${stColor}">${trade.ticker} &mdash; ${trade.strategy}</span>` +
      `&nbsp;&middot;&nbsp;Entry ${trade.entry_date} @ ${fmtCur(trade.entry_price)}` +
      `&nbsp;&middot;&nbsp;Target ${fmtCur(trade.exit_target)}` +
      (isOpen
        ? `&nbsp;&middot;&nbsp;<span style="color:var(--amber)">OPEN (${trade.trade_duration_days}d)</span>`
        : `&nbsp;&middot;&nbsp;Exit ${trade.exit_date} @ ${fmtCur(trade.exit_price)}&nbsp;${pnlStr}`);
  }

  const W  = ctr.clientWidth || 800;
  const H  = 260;
  const PL = 64, PR = 16, PT = 16, PB = 28;
  const CW = W - PL - PR, CH = H - PT - PB;
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (parent) parent.appendChild(e);
    return e;
  };

  // Y range: close, MA, envelopes, entry, target
  const closes  = prices.map((p) => p.close).filter(Boolean);
  const envLows = prices.map((p) => p.env_lower).filter(Boolean);
  const envHigh = prices.map((p) => p.env_upper).filter(Boolean);
  const allVals = [...closes, ...envLows, ...envHigh, trade.entry_price, trade.exit_target];
  if (!isOpen && trade.exit_price) allVals.push(trade.exit_price);
  const minV = Math.min(...allVals) * 0.967;
  const maxV = Math.max(...allVals) * 1.033;
  const rng  = maxV - minV || 1;
  const n    = prices.length;

  const xPos = (i) => PL + (i / (n - 1 || 1)) * CW;
  const yPos = (v) => PT + CH - ((v - minV) / rng) * CH;

  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';

  // Grid
  for (let i = 0; i <= 4; i++) {
    const v = minV + (rng / 4) * i;
    mk('line', { x1: PL, x2: PL + CW, y1: yPos(v).toFixed(1), y2: yPos(v).toFixed(1), stroke: '#1c2e45', 'stroke-width': '0.5' }, svg);
    mk('text', { x: PL - 5, y: (yPos(v) + 4).toFixed(1), 'text-anchor': 'end', fill: '#4e6278', 'font-size': '10', 'font-family': 'JetBrains Mono,monospace' }, svg).textContent = fmt(v, 0);
  }
  const seenM = new Set();
  prices.forEach((p, i) => {
    const m = p.date.slice(0, 7);
    if (seenM.has(m)) return;
    seenM.add(m);
    mk('text', { x: xPos(i).toFixed(1), y: H - 4, 'text-anchor': 'middle', fill: '#4e6278', 'font-size': '10', 'font-family': 'JetBrains Mono,monospace' }, svg).textContent = m;
  });

  // Shaded trade region
  const relEntry = prices.findIndex((p) => p.date >= trade.entry_date);
  const relExit  = isOpen ? n - 1 : prices.findIndex((p) => p.date >= exitDate);
  if (relEntry >= 0 && relExit >= relEntry) {
    mk('rect', {
      x: xPos(relEntry).toFixed(1), y: PT,
      width: (xPos(relExit) - xPos(relEntry)).toFixed(1), height: CH,
      fill: isOpen ? 'rgba(245,158,11,0.05)' : 'rgba(56,189,248,0.05)',
    }, svg);
  }

  // Envelope bands
  const drawLine = (color, key, dash) => {
    let d = '';
    prices.forEach((p, i) => {
      if (p[key] == null) return;
      d += `${d === '' ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(p[key]).toFixed(1)} `;
    });
    if (!d) return;
    const attr = { d: d.trim(), fill: 'none', stroke: color, 'stroke-width': '1' };
    if (dash) attr['stroke-dasharray'] = '5,4';
    mk('path', attr, svg);
  };

  drawLine('#22c55e', 'env_lower', true);   // lower env (green)
  drawLine('#ef4444', 'env_upper', true);   // upper env (red)
  drawLine('#f59e0b', 'ma200',     true);   // MA (amber)

  // Target line
  const ty = yPos(trade.exit_target).toFixed(1);
  mk('line', { x1: PL, x2: PL + CW, y1: ty, y2: ty, stroke: stColor, 'stroke-width': '1.5', 'stroke-dasharray': '5,3' }, svg);
  mk('text', { x: (PL + CW - 3).toFixed(1), y: (parseFloat(ty) - 4).toFixed(1), 'text-anchor': 'end', fill: stColor, 'font-size': '9', 'font-family': 'JetBrains Mono,monospace' }, svg).textContent = `Target ${fmtCur(trade.exit_target)}`;

  // Price line
  mk('path', {
    d: prices.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(p.close).toFixed(1)}`).join(' '),
    fill: 'none', stroke: '#38bdf8', 'stroke-width': '2', 'stroke-linejoin': 'round',
  }, svg);

  // Entry marker
  if (relEntry >= 0) {
    const ex = xPos(relEntry).toFixed(1), ey = yPos(prices[relEntry].close).toFixed(1);
    mk('circle', { cx: ex, cy: ey, r: '6', fill: '#22c55e', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    mk('text', { x: ex, y: (parseFloat(ey) - 10).toFixed(1), 'text-anchor': 'middle', fill: '#22c55e', 'font-size': '9', 'font-family': 'JetBrains Mono,monospace' }, svg).textContent = `Entry ${fmtCur(trade.entry_price)}`;
  }

  // Exit marker
  if (!isOpen && relExit >= 0) {
    const exitColor = trade.exit_reason === 'ENV_EXIT' ? '#22c55e' : trade.exit_reason === 'MA_EXIT' ? '#38bdf8' : '#ef4444';
    const xx = xPos(relExit).toFixed(1), xy = yPos(prices[relExit].close).toFixed(1);
    mk('circle', { cx: xx, cy: xy, r: '6', fill: exitColor, stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    mk('text', { x: xx, y: (parseFloat(xy) + 18).toFixed(1), 'text-anchor': 'middle', fill: exitColor, 'font-size': '9', 'font-family': 'JetBrains Mono,monospace' }, svg).textContent = `Exit ${fmtCur(trade.exit_price)}`;
  }

  // Current price marker (open)
  if (isOpen) {
    const lastP = prices[n - 1];
    const lx = xPos(n - 1).toFixed(1), ly = yPos(lastP.close).toFixed(1);
    mk('circle', { cx: lx, cy: ly, r: '6', fill: '#f59e0b', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    mk('text', { x: (parseFloat(lx) - 5).toFixed(1), y: (parseFloat(ly) - 10).toFixed(1), 'text-anchor': 'end', fill: '#f59e0b', 'font-size': '9', 'font-family': 'JetBrains Mono,monospace' }, svg).textContent = `Now ${fmtCur(lastP.close)}`;
  }

  // Hover
  const overlay = mk('rect', { x: PL, y: PT, width: CW, height: CH, fill: 'transparent', style: 'cursor:crosshair' }, svg);
  const vline   = mk('line', { x1: 0, x2: 0, y1: PT, y2: PT + CH, stroke: '#475569', 'stroke-width': '1', 'stroke-dasharray': '3,2', display: 'none' }, svg);
  overlay.addEventListener('mousemove', (e) => {
    const rect = ctr.getBoundingClientRect();
    const idx  = Math.max(0, Math.min(n - 1, Math.round((e.clientX - rect.left - PL) / CW * (n - 1))));
    const pt   = prices[idx];
    const vx   = xPos(idx).toFixed(1);
    vline.setAttribute('x1', vx); vline.setAttribute('x2', vx); vline.setAttribute('display', '');
    if (tip) {
      tip.style.display = 'block';
      tip.style.left = `${Math.min(e.clientX - rect.left + 10, W - 160)}px`;
      tip.style.top  = `${e.clientY - rect.top - 10}px`;
      tip.innerHTML  = `<div style="font-weight:600;margin-bottom:3px">${pt.date}</div>
        <div>Close: <b>${fmtCur(pt.close)}</b></div>
        ${pt.ma200    ? `<div style="color:#f59e0b;font-size:0.78rem">MA200: ${fmtCur(pt.ma200)}</div>`     : ''}
        ${pt.env_lower ? `<div style="color:#22c55e;font-size:0.78rem">Lower: ${fmtCur(pt.env_lower)}</div>` : ''}
        ${pt.env_upper ? `<div style="color:#ef4444;font-size:0.78rem">Upper: ${fmtCur(pt.env_upper)}</div>` : ''}`;
    }
  });
  overlay.addEventListener('mouseleave', () => { vline.setAttribute('display', 'none'); if (tip) tip.style.display = 'none'; });
}

/* ── CAGR diff badge for strategy toggle ──────────────────── */
function updateEnvDiffBadges() {
  const base = _envData.long?.summary?.cagr_pct ?? null;
  if (base === null) return;
  [
    ['lower',    'env-lower-diff'],
    ['upper',    'env-upper-diff'],
    ['combined', 'env-combined-diff'],
  ].forEach(([key, badgeId]) => {
    const d = _envData[key];
    if (!d) return;
    const btn = document.querySelector(`#env-strategy-bar .exit-mode-btn[data-envmode="${key}"]`);
    if (btn) btn.disabled = false;
    const badge = el(badgeId);
    if (!badge) return;
    const diff = (d.summary?.cagr_pct ?? 0) - base;
    badge.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
    badge.className   = `exit-diff-badge ${diff >= 0 ? 'exit-diff-pos' : 'exit-diff-neg'}`;
    badge.style.display = '';
  });
}

/* ── Master render ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════
   ENVELOPE OPPORTUNITY SCANNER  (Sub-tab 3)
═══════════════════════════════════════════════════════════════ */

let _envScanZone   = 'ALL';
let _envScanCap    = 'ALL';
let _envScanQ      = '';
let _envScanInited = false;

function renderEnvScanner() {
  const body  = el('env-scan-body');
  const empty = el('env-scan-empty');
  if (!body) return;

  // Wire up filters once
  if (!_envScanInited) {
    _envScanInited = true;
    el('env-scan-search')?.addEventListener('input',  (e) => { _envScanQ   = e.target.value;  renderEnvScanner(); });
    el('env-scan-cap')?.addEventListener('change',    (e) => { _envScanCap = e.target.value;  renderEnvScanner(); });
    document.querySelectorAll('.env-sfb').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.env-sfb').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        _envScanZone = btn.dataset.envzone;
        renderEnvScanner();
      });
    });
  }

  const ep = _envActive?.meta?.envelope_pct ?? 14;
  const epEl = el('env-scan-ep');
  if (epEl) epEl.textContent = ep;

  const q = (_envScanQ || '').toLowerCase();
  let filtered = scannerRows.filter((r) => {
    if (q && !r.ticker.toLowerCase().includes(q)) return false;
    if (_envScanCap !== 'ALL' && r.cap_tier !== _envScanCap) return false;
    const dist = r.distance_to_lower_envelope_pct;
    if (_envScanZone === 'CANDIDATE' && !(r.signals || []).includes('ENVELOPE_LONG_CANDIDATE')) return false;
    if (_envScanZone === 'NEAR' && (dist == null || dist > 10)) return false;
    return true;
  });

  // Sort: closest to lower envelope first (ascending distance)
  filtered.sort((a, b) => (a.distance_to_lower_envelope_pct ?? 99) - (b.distance_to_lower_envelope_pct ?? 99));

  // Update count badges
  const cCand = scannerRows.filter((r) => (r.signals || []).includes('ENVELOPE_LONG_CANDIDATE')).length;
  const cNear = scannerRows.filter((r) => r.distance_to_lower_envelope_pct != null && r.distance_to_lower_envelope_pct <= 10).length;
  const setW  = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  setW('env-scan-total', scannerRows.length);
  setW('env-sfb-cand-count', cCand);
  setW('env-sfb-near-count', cNear);
  setW('env-scan-count', filtered.length);

  body.innerHTML = '';
  if (empty) empty.style.display = filtered.length ? 'none' : 'block';
  if (!filtered.length) return;

  filtered.forEach((r) => {
    const dist   = r.distance_to_lower_envelope_pct;
    const isCand = (r.signals || []).includes('ENVELOPE_LONG_CANDIDATE');
    const distCls = isCand ? 'dist-green' : (dist != null && dist <= 10 ? 'dist-amber' : 'dist-muted');
    const upside  = r.upper_envelope && r.close ? ((r.upper_envelope - r.close) / r.close * 100) : null;
    const peStr   = r.pe_current != null
      ? `${r.pe_current.toFixed(0)}<span style="color:var(--muted);font-size:0.72rem"> / ${r.pe_5yr_avg != null ? r.pe_5yr_avg.toFixed(0) : '—'}</span>`
      : '—';
    const sigHtml = isCand
      ? '<span class="signal-pill signal-env">LONG CANDIDATE</span>'
      : dist != null && dist <= 5
      ? '<span class="signal-pill signal-none">APPROACHING</span>'
      : '';

    body.insertAdjacentHTML('beforeend', `<tr>
      <td style="font-weight:600">${r.ticker}</td>
      <td><span class="cap-badge ${capCls(r.cap_tier)}">${r.cap_tier?.replace(' Cap', '') || '—'}</span></td>
      <td style="color:var(--muted);font-size:0.8rem">${r.sector || '—'}</td>
      <td>${fmtCur(r.close)}</td>
      <td style="color:var(--amber)">${fmtCur(r.ma)}</td>
      <td style="color:var(--green)">${fmtCur(r.lower_envelope)}</td>
      <td class="${distCls}" style="font-size:0.85rem;font-family:var(--font-mono)">${dist != null ? fmtPct(dist) : '—'}</td>
      <td style="color:var(--red)">${fmtCur(r.upper_envelope)}</td>
      <td class="pnl-pos" style="font-size:0.85rem;font-family:var(--font-mono)">${upside != null ? fmtPct(upside) : '—'}</td>
      <td style="font-size:0.82rem">${peStr}</td>
      <td>${sigHtml}</td>
    </tr>`);
  });
}

/* ══════════════════════════════════════════════════════════════
   ENVELOPE STOCK ANALYSIS  (Sub-tab 4)
═══════════════════════════════════════════════════════════════ */

let _envSATicker    = null;
let _envSARangeYrs  = 0;
let _envSAInited    = false;

function renderEnvStockAnalysis() {
  if (!_envSAInited) {
    _envSAInited = true;
    el('env-sa-search')?.addEventListener('input', () => renderEnvSAStockList());
    document.querySelectorAll('.env-sa-rb').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.env-sa-rb').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        _envSARangeYrs = parseInt(btn.dataset.range, 10);
        if (_envSATicker) drawEnvSAChart(_envSATicker);
      });
    });
    window.addEventListener('resize', () => {
      if (el('envtab-stockanalysis')?.classList.contains('active') && _envSATicker) drawEnvSAChart(_envSATicker);
    });
  }
  renderEnvSAStockList();
  if (_envSATicker) renderEnvSADetail(_envSATicker);
}

function renderEnvSAStockList() {
  const listEl = el('env-sa-list');
  if (!listEl) return;
  const prices = _envActive?.stock_prices || {};
  const tickers = Object.keys(prices).sort();
  const q = (el('env-sa-search')?.value || '').toLowerCase();

  // Build a live-data lookup from scannerRows
  const liveMap = new Map(scannerRows.map((r) => [r.ticker, r]));
  // Build a trades count lookup
  const tradesMap = new Map();
  (_envActive?.trades || []).forEach((t) => {
    tradesMap.set(t.ticker, (tradesMap.get(t.ticker) || 0) + 1);
  });

  listEl.innerHTML = '';
  tickers.filter((tk) => !q || tk.toLowerCase().includes(q)).forEach((tk) => {
    const live = liveMap.get(tk);
    const trCnt = tradesMap.get(tk) || 0;
    const isCand = (live?.signals || []).includes('ENVELOPE_LONG_CANDIDATE');
    const dist = live?.distance_to_lower_envelope_pct;
    const distLabel = dist != null
      ? `<span class="dist-text ${isCand ? 'dist-green' : dist <= 10 ? 'dist-amber' : 'dist-muted'}">${fmtPct(dist)}</span>`
      : '';
    const isActive = tk === _envSATicker;
    listEl.insertAdjacentHTML('beforeend',
      `<li class="stock-list-item${isActive ? ' active' : ''}" data-ticker="${tk}">
        <div class="sli-main">
          <span class="sli-ticker">${tk}</span>
          ${isCand ? '<span class="signal-pill signal-env" style="font-size:0.65rem;padding:1px 5px">CANDIDATE</span>' : ''}
        </div>
        <div class="sli-sub">${trCnt} trade${trCnt !== 1 ? 's' : ''} &nbsp;${distLabel}</div>
      </li>`
    );
  });

  listEl.querySelectorAll('.stock-list-item').forEach((li) => {
    li.addEventListener('click', () => {
      _envSATicker = li.dataset.ticker;
      renderEnvSAStockList();
      renderEnvSADetail(_envSATicker);
    });
  });
}

function renderEnvSADetail(ticker) {
  const prices  = _envActive?.stock_prices?.[ticker] || [];
  const trades  = (_envActive?.trades || []).filter((t) => t.ticker === ticker);
  const live    = scannerRows.find((r) => r.ticker === ticker);

  const titleEl = el('env-sa-trade-title');
  if (titleEl) titleEl.textContent = `${ticker} — ${trades.length} trades`;

  // Metric cards
  const wins    = trades.filter((t) => t.pnl_pct != null && t.pnl_pct >= 0 && t.exit_reason !== 'OPEN').length;
  const closed  = trades.filter((t) => t.exit_reason !== 'OPEN').length;
  const openCnt = trades.filter((t) => t.exit_reason === 'OPEN').length;
  const avgPnl  = closed ? trades.filter((t) => t.exit_reason !== 'OPEN').reduce((s, t) => s + (t.pnl_pct || 0), 0) / closed : null;
  buildMetricCards(el('env-sa-metric-row'), [
    { label: 'Current Price', value: fmtCur(live?.close),            cls: 'accent' },
    { label: 'Lower Env',     value: fmtCur(live?.lower_envelope),   cls: 'green' },
    { label: 'Upper Env',     value: fmtCur(live?.upper_envelope),   cls: 'red' },
    { label: 'Dist to Lower', value: live?.distance_to_lower_envelope_pct != null ? fmtPct(live.distance_to_lower_envelope_pct) : '—',
      cls: (live?.signals || []).includes('ENVELOPE_LONG_CANDIDATE') ? 'green' : '' },
    { label: 'Trades',        value: trades.length, sub: `${openCnt} open` },
    { label: 'Win Rate',      value: closed ? fmtPct(wins / closed * 100) : '—', cls: closed && wins / closed >= 0.5 ? 'green' : 'amber' },
    { label: 'Avg P/L',       value: fmtPct(avgPnl), cls: (avgPnl || 0) >= 0 ? 'green' : 'red' },
  ]);

  drawEnvSAChart(ticker);

  // Trade table
  const tbody = el('env-sa-trades-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  trades.forEach((t, i) => {
    const stColor  = ENV_STRATEGY_COLORS[t.strategy] || '#94a3b8';
    const stLabel  = { LONG_FULL: 'Long↑', LOWER_HALF: 'Lower½', UPPER_HALF: 'Upper½' }[t.strategy] || t.strategy;
    const pnlCls   = (t.pnl_pct || 0) >= 0 ? 'pnl-pos' : 'pnl-neg';
    const outcome  = t.exit_reason === 'ENV_EXIT'
      ? '<span class="exit-badge" style="background:rgba(34,197,94,0.15);color:var(--green);border-color:rgba(34,197,94,0.3)">ENV EXIT</span>'
      : t.exit_reason === 'MA_EXIT'
      ? '<span class="exit-badge" style="background:rgba(56,189,248,0.15);color:var(--accent);border-color:rgba(56,189,248,0.3)">MA EXIT</span>'
      : '<span class="exit-badge" style="background:rgba(148,163,184,0.12);color:var(--muted)">OPEN</span>';
    tbody.insertAdjacentHTML('beforeend', `<tr>
      <td style="color:var(--muted)">${i + 1}</td>
      <td><span style="font-size:0.78rem;font-weight:600;color:${stColor}">${stLabel}</span></td>
      <td style="color:var(--muted);font-size:0.8rem">${t.entry_date ?? '—'}</td>
      <td>${fmtCur(t.entry_price)}</td>
      <td style="color:var(--accent)">${fmtCur(t.exit_target)}</td>
      <td style="color:var(--muted);font-size:0.8rem">${t.exit_date ?? '—'}</td>
      <td>${t.exit_price != null ? fmtCur(t.exit_price) : '—'}</td>
      <td style="color:var(--muted)">${t.trade_duration_days != null ? t.trade_duration_days + 'd' : '—'}</td>
      <td class="${pnlCls}">${t.pnl_pct != null ? fmtPct(t.pnl_pct) : '—'}</td>
      <td class="${pnlCls}">${t.pnl != null ? fmtCur(t.pnl) : '—'}</td>
      <td>${outcome}</td>
    </tr>`);
  });
}

function drawEnvSAChart(ticker) {
  const svg = el('env-sa-chart');
  const tip = el('env-sa-tooltip');
  const ctr = el('env-sa-chart-container');
  if (!svg || !ctr) return;

  const allPrices = _envActive?.stock_prices?.[ticker] || [];
  if (!allPrices.length) { svg.innerHTML = ''; return; }

  let prices = allPrices;
  if (_envSARangeYrs > 0) {
    const cut = new Date();
    cut.setFullYear(cut.getFullYear() - _envSARangeYrs);
    const cutStr = cut.toISOString().slice(0, 10);
    prices = allPrices.filter((p) => p.date >= cutStr);
  }
  if (!prices.length) { svg.innerHTML = ''; return; }

  const W  = ctr.clientWidth  || 860;
  const H  = ctr.clientHeight || 320;
  const PL = 58, PR = 12, PT = 14, PB = 30;
  const CW = W - PL - PR, CH = H - PT - PB;
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    parent.appendChild(e);
    return e;
  };

  const pStart = prices[0].date, pEnd = prices[prices.length - 1].date;
  const trades = (_envActive?.trades || []).filter((t) => t.ticker === ticker);

  const allVals = prices.flatMap((p) => [p.close, p.ma200, p.env_lower, p.env_upper].filter(Boolean));
  const minV = Math.min(...allVals) * 0.975;
  const maxV = Math.max(...allVals) * 1.025;
  const rng  = maxV - minV || 1;
  const n    = prices.length;

  const xPos = (i) => PL + (i / (n - 1 || 1)) * CW;
  const yPos = (v) => PT + CH - ((v - minV) / rng) * CH;

  svg.setAttribute('width',   W);
  svg.setAttribute('height',  H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';

  // Grid lines + Y labels
  for (let i = 0; i <= 4; i++) {
    const v = minV + (rng / 4) * i, yp = yPos(v);
    mk('line', { x1: PL, x2: PL + CW, y1: yp, y2: yp, stroke: '#1c2e45', 'stroke-width': '0.8' }, svg);
    mk('text', { x: PL - 6, y: yp + 4, 'text-anchor': 'end', fill: '#4e6278', 'font-size': '11', 'font-family': 'JetBrains Mono,monospace' }, svg).textContent = fmt(v, 0);
  }
  // X labels — one per year
  const seenYr = new Set();
  prices.forEach((p, i) => {
    const yr = p.date.slice(0, 4);
    if (seenYr.has(yr)) return;
    seenYr.add(yr);
    mk('text', { x: xPos(i), y: H - 4, 'text-anchor': 'middle', fill: '#4e6278', 'font-size': '11', 'font-family': 'JetBrains Mono,monospace' }, svg).textContent = yr;
  });

  // Indicator lines
  const drawLine = (color, key, dash) => {
    let d = '';
    prices.forEach((p, i) => {
      if (p[key] == null) return;
      d += `${d === '' || prices[i - 1]?.[key] == null ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(p[key]).toFixed(1)} `;
    });
    if (!d) return;
    const attr = { d: d.trim(), fill: 'none', stroke: color, 'stroke-width': '1.5' };
    if (dash) attr['stroke-dasharray'] = '5,4';
    mk('path', attr, svg);
  };
  drawLine('#f59e0b', 'ma200',     true);
  drawLine('#22c55e', 'env_lower', true);
  drawLine('#ef4444', 'env_upper', true);

  // Close price (solid, on top)
  const closePath = prices.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(p.close).toFixed(1)}`).join(' ');
  mk('path', { d: closePath, fill: 'none', stroke: '#38bdf8', 'stroke-width': '2' }, svg);

  // Trade markers
  trades.forEach((t) => {
    const isOpen = t.exit_reason === 'OPEN';
    if (t.entry_date >= pStart && t.entry_date <= pEnd) {
      const ei = prices.findIndex((p) => p.date >= t.entry_date);
      if (ei !== -1) mk('circle', { cx: xPos(ei).toFixed(1), cy: yPos(prices[ei].close).toFixed(1), r: '5', fill: '#22c55e', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    }
    if (!isOpen && t.exit_date >= pStart && t.exit_date <= pEnd) {
      const xi = prices.findIndex((p) => p.date >= t.exit_date);
      if (xi !== -1) mk('circle', { cx: xPos(xi).toFixed(1), cy: yPos(prices[xi].close).toFixed(1), r: '5', fill: '#ef4444', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    }
    if (isOpen && t.entry_date >= pStart) {
      const oi = prices.findIndex((p) => p.date >= t.entry_date);
      if (oi !== -1) mk('circle', { cx: xPos(oi).toFixed(1), cy: yPos(prices[oi].close).toFixed(1), r: '6', fill: '#f59e0b', stroke: '#070c15', 'stroke-width': '1.5' }, svg);
    }
  });

  // Hover overlay + tooltip
  const overlay = mk('rect', { x: PL, y: PT, width: CW, height: CH, fill: 'transparent', cursor: 'crosshair' }, svg);
  const crossV  = mk('line', { x1: 0, x2: 0, y1: PT, y2: PT + CH, stroke: '#475569', 'stroke-width': '1', 'stroke-dasharray': '3,3', visibility: 'hidden' }, svg);

  overlay.addEventListener('mousemove', (e) => {
    const rect = ctr.getBoundingClientRect();
    const idx  = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left - PL) / CW) * (n - 1))));
    const p = prices[idx];
    if (!p || !tip) return;
    const xp = xPos(idx);
    crossV.setAttribute('x1', xp); crossV.setAttribute('x2', xp); crossV.setAttribute('visibility', 'visible');
    tip.style.display = 'block';
    tip.innerHTML = `
      <div class="tooltip-date">${p.date}</div>
      <div class="tooltip-row"><span class="tooltip-label">Close</span><span class="tooltip-val" style="color:#38bdf8">${fmtCur(p.close)}</span></div>
      ${p.ma200     != null ? `<div class="tooltip-row"><span class="tooltip-label">200 DMA</span><span class="tooltip-val" style="color:#f59e0b">${fmtCur(p.ma200)}</span></div>` : ''}
      ${p.env_lower != null ? `<div class="tooltip-row"><span class="tooltip-label">Lower Env</span><span class="tooltip-val" style="color:#22c55e">${fmtCur(p.env_lower)}</span></div>` : ''}
      ${p.env_upper != null ? `<div class="tooltip-row"><span class="tooltip-label">Upper Env</span><span class="tooltip-val" style="color:#ef4444">${fmtCur(p.env_upper)}</span></div>` : ''}
    `;
    const tipW = 178, left = xp + PL + 12 + tipW > W ? xp + PL - tipW - 12 : xp + PL + 12;
    tip.style.left = `${left}px`; tip.style.top = `${PT + 8}px`;
  });
  overlay.addEventListener('mouseleave', () => { crossV.setAttribute('visibility', 'hidden'); if (tip) tip.style.display = 'none'; });
}

function renderEnvTab() {
  updateEnvModeDesc();
  renderEnvSummary();
  renderEnvYearlyReturns();
  renderEnvTierStats();
  renderEnvTickerPills();
  renderEnvTradeLog();
  if (!_envInited) {
    _envInited = true;
    el('env-pb-search')?.addEventListener('input',   (e) => { _envFilters.search   = e.target.value; renderEnvTradeLog(); });
    el('env-pb-filter-status')?.addEventListener('change', (e) => { _envFilters.status   = e.target.value; renderEnvTradeLog(); });
    el('env-pb-filter-cap')?.addEventListener('change',    (e) => { _envFilters.cap      = e.target.value; renderEnvTradeLog(); });
    el('env-pb-filter-strategy')?.addEventListener('change',(e) => { _envFilters.strategy = e.target.value; renderEnvTradeLog(); });
  }
}

/* ── Init: called once per loaded dataset ─────────────────── */
function initEnvData(mode, data) {
  _envData[mode] = data;
  if (mode === _envMode) {
    _envActive = data;
    renderEnvTab();
    drawEnvPortfolioChart();
  }
  // Always update diff badges when any dataset arrives
  updateEnvDiffBadges();
}

loadData();
