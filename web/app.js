/* ── Format helpers ─────────────────────────────────────────── */
const fmt    = (v, d = 2) => v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtPct = (v) => v == null ? '—' : `${Number(v) >= 0 ? '+' : ''}${fmt(v)}%`;
const fmtCur = (v) => v == null ? '—' : `₹${fmt(v)}`;
const pctCls = (v) => v == null ? '' : v >= 0 ? 'pnl-pos' : 'pnl-neg';
const capCls = (t = '') => t.includes('Large') ? 'cap-large' : t.includes('Mid') ? 'cap-mid' : 'cap-small';
const el     = (id) => document.getElementById(id);

/* ── Left-nav page switching ────────────────────────────────── */
document.querySelectorAll('.nav-item:not(.disabled)').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    item.classList.add('active');
    el(`page-${item.dataset.page}`)?.classList.add('active');
    el('sidebar').classList.remove('open');
  });
});

el('sidebar-toggle')?.addEventListener('click', () => el('sidebar').classList.toggle('open'));

/* ── Sub-tab switching (within 52W page) ────────────────────── */
document.querySelectorAll('.subtab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.subtab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.subtab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    el(`subtab-${btn.dataset.subtab}`)?.classList.add('active');
    if (btn.dataset.subtab === 'stock-analysis') drawChart();
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
let scannerRows = [];

function abcdLevels(price) {
  return [
    price * 0.90,
    price * 0.81,
    price * 0.729,
    price * 0.6561,
  ];
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
  if (!rows.length) { emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';

  rows.forEach((row) => {
    const close = row.close, w52l = row['52w_low'], w52h = row['52w_high'];
    const dist  = row.distance_to_52w_low_pct;
    const gain  = w52h && close ? ((w52h - close) / close) * 100 : null;
    const [a, b, c, d] = abcdLevels(w52l || close);
    const isCandidate = (row.signals || []).includes('52W_LOW_BUY_CANDIDATE');
    const barW = Math.max(0, Math.min(100, 100 - (dist || 0) * 12));
    const distCls = isCandidate ? 'dist-green' : (dist < 10 ? 'dist-amber' : 'dist-muted');

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
        <td style="color:var(--muted);font-size:0.8rem">${fmtCur(a)}</td>
        <td style="color:var(--muted);font-size:0.8rem">${fmtCur(b)}</td>
        <td style="color:var(--muted);font-size:0.8rem">${fmtCur(c)}</td>
        <td style="color:var(--muted);font-size:0.8rem">${fmtCur(d)}</td>
        <td>${isCandidate ? '<span class="exit-badge">BUY ZONE</span>' : '<span style="color:var(--muted);font-size:0.78rem">Watching</span>'}</td>
      </tr>`);
  });
}

function renderAllStocks(rows) {
  const body = el('all-stocks-body');
  if (!body) return;
  body.innerHTML = '';
  rows.forEach((row) => {
    const distLow  = row.distance_to_52w_low_pct;
    const distHigh = row.distance_to_52w_high_pct;
    const distDma  = row.distance_to_lower_envelope_pct; // using as proxy for DMA dist
    const barW = Math.max(0, Math.min(100, 100 - (distLow || 0) * 12));
    const isCandidate = (row.signals || []).includes('52W_LOW_BUY_CANDIDATE');
    const distCls = isCandidate ? 'dist-green' : (distLow < 10 ? 'dist-amber' : 'dist-muted');

    body.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${row.ticker}</td>
        <td><span class="cap-badge ${capCls(row.cap_tier)}">${row.cap_tier.replace(' Cap','')}</span></td>
        <td style="color:var(--muted)">${row.sector}</td>
        <td>${fmtCur(row.close)}</td>
        <td style="color:var(--green)">${fmtCur(row['52w_low'])}</td>
        <td><div class="dist-cell"><div class="dist-bar-wrap"><div class="dist-bar" style="width:${barW}%"></div></div><span class="dist-text ${distCls}">${fmtPct(distLow)}</span></div></td>
        <td style="color:var(--red)">${fmtCur(row['52w_high'])}</td>
        <td class="${distHigh < 0 ? 'pnl-neg' : 'pnl-pos'}">${fmtPct(distHigh)}</td>
        <td style="color:var(--amber)">${fmtCur(row.ma)}</td>
        <td style="color:var(--muted)">${fmtPct(row.distance_to_lower_envelope_pct)}</td>
        <td><div class="signal-wrap">${signalPillHtml(row.signals)}</div></td>
      </tr>`);
  });
}

function filterSortScanner() {
  const q    = (el('scanner-search')?.value || '').toLowerCase();
  const sec  = el('scanner-sector')?.value || 'ALL';
  const sort = el('scanner-sort')?.value || 'distance';
  let rows = scannerRows.filter((r) =>
    (!q || r.ticker.toLowerCase().includes(q)) &&
    (sec === 'ALL' || r.sector === sec)
  );
  rows = [...rows].sort((a, b) => {
    if (sort === 'distance') return (a.distance_to_52w_low_pct || 999) - (b.distance_to_52w_low_pct || 999);
    if (sort === 'gain') {
      const ga = a['52w_high'] && a.close ? (a['52w_high'] - a.close) / a.close : 0;
      const gb = b['52w_high'] && b.close ? (b['52w_high'] - b.close) / b.close : 0;
      return gb - ga;
    }
    return a.ticker.localeCompare(b.ticker);
  });
  renderScanner(rows);
}

function filterSortAllStocks(allRows) {
  const q    = (el('all-stocks-search')?.value || '').toLowerCase();
  const sec  = el('all-stocks-sector')?.value || 'ALL';
  const sort = el('all-stocks-sort')?.value || 'dist-low';
  let rows = allRows.filter((r) =>
    (!q || r.ticker.toLowerCase().includes(q)) &&
    (sec === 'ALL' || r.sector === sec)
  );
  rows = [...rows].sort((a, b) => {
    if (sort === 'dist-low')  return (a.distance_to_52w_low_pct  || 999) - (b.distance_to_52w_low_pct  || 999);
    if (sort === 'dist-high') return (a.distance_to_52w_high_pct || 999) - (b.distance_to_52w_high_pct || 999);
    if (sort === 'gain') {
      const ga = a['52w_high'] && a.close ? (a['52w_high'] - a.close) / a.close : 0;
      const gb = b['52w_high'] && b.close ? (b['52w_high'] - b.close) / b.close : 0;
      return gb - ga;
    }
    return a.ticker.localeCompare(b.ticker);
  });
  renderAllStocks(rows);
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
    mk('line', { x1: PL, x2: PL + CW, y1: yp, y2: yp, stroke: '#1e2d45', 'stroke-width': '1' }, svg);
    const t = mk('text', { x: PL - 6, y: yp + 4, 'text-anchor': 'end', fill: '#475569', 'font-size': '11', 'font-family': 'Inter,sans-serif' }, svg);
    t.textContent = fmt(v, 0);
  }

  // X labels
  for (let k = 0; k <= 5; k++) {
    const idx = Math.round((k / 5) * (prices.length - 1));
    const t = mk('text', { x: xPos(idx), y: H - 4, 'text-anchor': 'middle', fill: '#475569', 'font-size': '11', 'font-family': 'Inter,sans-serif' }, svg);
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

function renderStockList(overview, stockData, sectorFilter, searchQ) {
  const list = el('stock-list');
  if (!list) return;
  list.innerHTML = '';

  let items = overview;
  if (sectorFilter && sectorFilter !== 'ALL') items = items.filter((s) => stockData[s.ticker]?.sector === sectorFilter);
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
   DATA LOADING
═══════════════════════════════════════════════════════════════ */
async function loadData() {
  try {
    const [sumR, rowsR, bt52wSumR, bt52wStkR] = await Promise.all([
      fetch('data/current_setup_summary.json'),
      fetch('data/current_setup.json'),
      fetch('data/backtest_52w_summary.json'),
      fetch('data/backtest_52w_stock_data.json'),
    ]);

    if (![sumR, rowsR, bt52wSumR, bt52wStkR].every((r) => r.ok))
      throw new Error('One or more data files missing. Run the backtest script then build_data.py.');

    const [currentSummary, currentRows, bt52wSummary, bt52wStockData] = await Promise.all([
      sumR.json(), rowsR.json(), bt52wSumR.json(), bt52wStkR.json(),
    ]);

    const overview  = bt52wStockData.overview  || [];
    const stockData = bt52wStockData.stock_data || {};

    // Last updated
    const luEl = el('last-updated');
    if (luEl) luEl.textContent = `Updated: ${bt52wSummary.backtest_date || currentSummary.run_date || '—'}`;

    // Strategy summary
    render52wSummary(bt52wSummary);

    // ── Opportunity Scanner ────────────────────────────────────
    scannerRows = currentRows || [];
    el('scanner-count').textContent = scannerRows.filter((r) => (r.signals || []).includes('52W_LOW_BUY_CANDIDATE')).length;

    populateSectorFilter(scannerRows, 'scanner-sector', 'all-stocks-sector', 'slp-sector-filter');

    filterSortScanner();
    filterSortAllStocks(scannerRows);

    el('scanner-search')?.addEventListener('input', filterSortScanner);
    el('scanner-sector')?.addEventListener('change', filterSortScanner);
    el('scanner-sort')?.addEventListener('change', filterSortScanner);
    el('all-stocks-search')?.addEventListener('input', () => filterSortAllStocks(currentRows));
    el('all-stocks-sector')?.addEventListener('change', () => filterSortAllStocks(currentRows));
    el('all-stocks-sort')?.addEventListener('change', () => filterSortAllStocks(currentRows));

    // ── Stock list (left panel) ────────────────────────────────
    let currentTicker = overview[0]?.ticker;
    let slpSector = 'ALL', slpSearch = '';

    function refreshStockList() {
      renderStockList(overview, stockData, slpSector, slpSearch);
      // Re-attach click listeners
      document.querySelectorAll('.stock-list-item').forEach((li) => {
        li.addEventListener('click', () => {
          currentTicker = li.dataset.ticker;
          renderStockDetail(stockData, currentTicker);
        });
      });
      if (currentTicker) setActiveListItem(currentTicker);
    }

    el('slp-sector-filter')?.addEventListener('change', (e) => { slpSector = e.target.value; refreshStockList(); });
    el('slp-search')?.addEventListener('input', (e) => { slpSearch = e.target.value; refreshStockList(); });

    refreshStockList();
    if (currentTicker) renderStockDetail(stockData, currentTicker);

  } catch (err) {
    el('main-wrapper').innerHTML = `
      <div style="padding:3rem;text-align:center;color:var(--muted)">
        <h2 style="color:var(--red);margin-bottom:1rem">Data not loaded</h2>
        <p style="max-width:480px;margin:0 auto;line-height:1.6">${err.message}</p>
        <p style="margin-top:1rem;font-size:0.82rem">Run <code>f40_backtest_52w.py</code> then <code>build_data.py</code> and refresh.</p>
      </div>`;
    console.error(err);
  }
}

loadData();
