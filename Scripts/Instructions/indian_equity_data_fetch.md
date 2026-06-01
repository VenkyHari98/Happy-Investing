# Indian Equity Data Fetch — Skill Instructions

**Purpose:** Read 3 structured watchlist `.txt` files, fetch all market and fundamental
data for each stock from 4 data sources, and compute a full indicator dictionary per stock.

---

## SECTION 1 — INPUT FILE FORMAT

You will be given 3 `.txt` files (one per market-cap tier). Each file uses this exact format:

```
Ticker;Large/Mid/Small;Sector
```

**Example file contents:**
```
RELIANCE;Large;Energy
HDFCBANK;Large;Financial Services
ZOMATO;Mid;Consumer Cyclical
KPITTECH;Small;Technology
```

### Parsing Rules

- Delimiter is semicolon (`;`). Always split on `;` — not comma or tab.
- **Column 1:** NSE ticker symbol — bare, no `.NS` or `.BO` suffix
- **Column 2:** Cap tier — exactly one of: `Large` | `Mid` | `Small`
- **Column 3:** Sector — free text, preserve exactly as written
- Skip lines starting with `#` (comments)
- Skip blank lines
- Skip the header row if present — detect by checking if column 1 is not all-caps or contains the word `Ticker`
- Strip whitespace from all three fields after splitting
- Maximum 200 symbols per file — warn and truncate if exceeded

### Parsing Code Pattern

```python
def parse_watchlist(path: str) -> list[dict]:
    stocks = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(";")
            if len(parts) < 3:
                continue
            ticker = parts[0].strip()
            cap    = parts[1].strip()
            sector = parts[2].strip()
            if not ticker or not cap or not sector:
                continue
            if ticker.lower() == "ticker":
                continue  # skip header row
            stocks.append({"ticker": ticker, "cap": cap, "sector": sector})
    return stocks
```

### After Parsing

- Append `.NS` to ticker for yfinance and NSE REST API calls → `RELIANCE.NS`
- Keep bare ticker for screener.in URL slugs and NSE Bhavcopy lookups → `RELIANCE`
- Store the original `cap` tier and `sector` from the file alongside all fetched data
- If the same ticker appears across multiple files, deduplicate — keep the first occurrence

---

## SECTION 2 — DATA DOWNLOADED PER STOCK

For each stock, data is fetched from 4 sources in the order listed below.
Sources are **independent** — a failure in one does not block the others.
Always attempt all 4 sources and merge results into a single stock dict.

---

### SOURCE A — yfinance (Primary: OHLCV + Company Info + Financials)

**Install:** `pip install yfinance`
**Ticker format:** `<SYMBOL>.NS` for NSE. Fallback: `<SYMBOL>.BO` (BSE) if NSE returns no price.

#### A1. OHLCV — Daily Candles

```python
t = yf.Ticker("<SYMBOL>.NS")
df = t.history(period="5y", interval="1d", auto_adjust=True)
```

- Columns returned: `Open`, `High`, `Low`, `Close`, `Volume`
- Normalize: lowercase column names, remove timezone from index, drop rows where `Close` is NaN
- **Fallback 1:** retry with `period="max"` — handles recently-listed stocks
- **Fallback 2:** retry with `<SYMBOL>.BO`
- **Fallback 3:** fall through to Source B6, then Source D

#### A2. Company Info — `t.info` dict

**Price & Market:**

| Field | Description |
|---|---|
| `currentPrice` / `regularMarketPrice` | Live price (use whichever is non-zero) |
| `previousClose` | Prior day close |
| `marketCap` | Raw INR — divide by `1e7` for ₹ Crores |
| `volume` | Today's traded volume |
| `averageVolume` | 30-day average volume |
| `fiftyTwoWeekHigh` | 52-week high |
| `fiftyTwoWeekLow` | 52-week low |

**Fundamentals:**

| Field | Description |
|---|---|
| `trailingPE` | P/E ratio (trailing 12 months) |
| `priceToBook` | Price-to-Book value |
| `returnOnEquity` | ROE — decimal; multiply by 100 for % |
| `dividendYield` | Dividend yield — decimal; multiply by 100 for % |
| `beta` | Beta vs NIFTY 50 |
| `trailingEps` | EPS (trailing 12 months, ₹) |
| `bookValue` | Book value per share (₹) |
| `debtToEquity` | D/E ratio — raw; divide by 100 for ratio form |
| `currentRatio` | Current ratio |

**Identity:**

| Field | Description |
|---|---|
| `longName` / `shortName` | Company display name |
| `sector` | yfinance sector string |
| `industry` | Sub-industry |
| `longBusinessSummary` | Business description — cap at 600 chars |

**Analyst:**

| Field | Description |
|---|---|
| `recommendationKey` | `buy` / `hold` / `sell` / `strong_buy` / `strong_sell` |
| `numberOfAnalystOpinions` | Analyst count |
| `targetHighPrice` | Analyst high price target |
| `targetMeanPrice` | Consensus price target |
| `targetLowPrice` | Analyst low price target |
| `targetMedianPrice` | Median price target |
| `forwardEps` | Forward EPS estimate |
| `pegRatio` | PEG ratio |

#### A3. Annual Financials — Last 4 Fiscal Years

```python
t.financials    # Income Statement
t.balance_sheet # Balance Sheet
t.cashflow      # Cash Flow Statement
```

All monetary values are raw INR — convert to ₹ Crores by dividing by `1e7`.
Year label: `"FY"` + last 2 digits of fiscal year end (e.g., `"FY24"`).

**Income Statement — key rows:**
`Total Revenue`, `Gross Profit`, `EBIT`, `Net Income`, `EBITDA`, `Interest Expense`

**Balance Sheet — key rows:**
`Total Assets`, `Total Liabilities Net Minority Interest`, `Stockholders Equity`,
`Cash And Cash Equivalents`, `Total Debt`, `Inventory`

**Cash Flow — key rows:**
`Operating Cash Flow`, `Capital Expenditure`, `Free Cash Flow`,
`Issuance Of Debt`, `Repayment Of Debt`

#### A4. Analyst Recommendations

```python
t.recommendations_summary  # columns: strongBuy, buy, hold, sell, strongSell
```

Take `iloc[0]` for the most recent period.

---

### SOURCE B — NSE REST API (NSE-Specific: F&O, Delivery, Surveillance, Deals)

**Base URL:** `https://www.nseindia.com`
**Ticker format:** Bare symbol only — no `.NS` or `.BO`

**Authentication:** NSE uses Akamai WAF. You must visit the homepage first to obtain session cookies:

```python
session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer":         "https://www.nseindia.com/",
})
session.get("https://www.nseindia.com/", timeout=10)
time.sleep(0.8)  # mandatory wait after homepage fetch
```

#### B1. Live Quote + Identity — `/api/quote-equity?symbol=<SYMBOL>`

| Sub-dict | Field | Use |
|---|---|---|
| `.info` | `isin` | ISIN code |
| `.info` | `faceValue` | Face value per share (₹) |
| `.info` | `series` | Should be `"EQ"` for normal equity |
| `.securityInfo` | `tradingStatus` | If `"FUTSTK"` is in string → F&O eligible |
| `.info` | `indices` | String — parse for index names (see below) |

**Index membership** — check `.info.indices` string for:
`"NIFTY 50"`, `"NIFTY NEXT 50"`, `"NIFTY 100"`, `"NIFTY 200"`, `"NIFTY 500"`

#### B2. Delivery Percentage — NSE Archives Bhav Data Full CSV

**URL pattern per day:**
```
https://archives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv
```

- Fetch last **30 trading days** — skip weekends (`weekday >= 5`)
- CSV columns used: `SYMBOL`, `DELIV_QTY`, `TTL_TRD_QNTY`
- `delivery_pct = (DELIV_QTY / TTL_TRD_QNTY) × 100`
- Store as: `list[{"date": "YYYY-MM-DD", "delivery_pct": float}]`
- Compute: `delivery_pct_avg` (30-day mean), `delivery_pct_latest` (most recent)

> High delivery % (>50%) = conviction buying. Low (<30%) = speculative / intraday driven.

#### B3. Bulk Deals — `/api/historical/bulk-deals`

Returns all recent bulk deals — filter by symbol. Keep last 20 records.

| Field | Description |
|---|---|
| `date` | Trade date |
| `clientName` | Buyer / seller name |
| `buySell` | `"BUY"` or `"SELL"` |
| `quantity` | Shares traded |
| `price` | Price per share (₹) |

#### B4. Insider / Promoter Trades — `/api/corporates-pit?symbol=<SYMBOL>&market=equities`

SEBI-mandated disclosures. Keep last 20 records.

| Field | Description |
|---|---|
| `date` | Disclosure date |
| `personName` | Insider / promoter name |
| `acquisitionMode` | `"Market Purchase"`, `"Open Market"`, `"ESOP"`, etc. |
| `noOfSharesAcquired` | > 0 → BUY action |
| `noOfSharesDisposed` | > 0 → SELL action |
| `value` | Transaction value in INR — divide by `1e7` for ₹ Crores |

Derived: `insider_net_action = "buying"` if acquired > disposed across last 20 trades, else `"selling"` or `"none"`.

#### B5. ASM / GSM Surveillance Stage

**Endpoints:** `/api/asm-securities` and `/api/gsm-securities`

Match by symbol. Extract `stage` or `gsm_stage` field.

- `asm_gsm_stage = 0` → clean stock, no regulatory concern
- `asm_gsm_stage = 1–6` → under surveillance — flag prominently in any output

> **Important:** Always surface this flag before any buy recommendation.

#### B6. Historical OHLCV via NSE Archives — Fallback Only

Use only when Source A fails.

**Endpoint:** `/api/historical/securityArchives`
**Params:** `from=DD-MM-YYYY`, `to=DD-MM-YYYY`, `symbol=<SYMBOL>`, `dataType=priceVolumeDeliverable`, `series=EQ`

- Chunk requests into 90-day windows; `time.sleep(0.5)` between chunks
- Fields: `CH_TIMESTAMP`, `CH_OPENING_PRICE`, `CH_HIGH_PRICE`, `CH_LOW_PRICE`, `CH_CLOSING_PRICE`, `CH_TOT_TRADED_QTY`
- Assemble into a DataFrame with the same schema as Source A OHLCV

---

### SOURCE C — screener.in (10-Year Fundamental History + Shareholding)

**URL:** `https://www.screener.in/company/<SYMBOL>/consolidated/`
**Fallback:** `https://www.screener.in/company/<SYMBOL>/` (standalone P&L)
**Auth:** None required for annual data
**Parser:** BeautifulSoup (`pip install beautifulsoup4 lxml`)
**Throttle:** `time.sleep(1.5)` between requests — screener.in actively rate-limits

**Page validation:** A valid company page has `soup.find(class_="company-ratios")` returning a non-None result. If missing, the URL returned a 404 or wrong page — skip and try next URL.

**Known ticker → URL slug mismatches** (maintain and extend as needed):

| NSE Ticker | screener.in Slug |
|---|---|
| `LTIM` | `LTIMINDTREE` |
| `NYKAA` | `FSN` |
| `PAYTM` | `ONE97` |
| `DMART` | `AVENUE` |
| `M&M` | `MAHINDRA` |

Always try the canonical ticker first, then fall back to known aliases.

#### C1. Profit & Loss — `section id="profit-loss"`, `class="data-table"`

10 years of annual data. Key rows:

`Revenue / Sales`, `Expenses`, `Operating Profit`, `OPM %`, `Other Income`,
`Interest`, `Depreciation`, `Profit before tax`, `Tax %`, `Net Profit`, `EPS`

#### C2. Balance Sheet — `section id="balance-sheet"`, `class="data-table"`

10 years of annual data. Key rows:

`Share Capital`, `Reserves`, `Borrowings`, `Other Liabilities`,
`Fixed Assets`, `CWIP`, `Investments`, `Other Assets`

#### C3. Cash Flow — `section id="cash-flow"`, `class="data-table"`

10 years of annual data. Key rows:

`Cash from Operating Activity`, `Cash from Investing Activity`, `Cash from Financing Activity`

Derived: `Free Cash Flow = Operating Cash Flow + Cash from Investing Activity`

#### C4. Key Ratios — `class="company-ratios"` list items

Single current-period values from `<li>` tags (`.name` + `.value` sub-elements):

`P/E`, `P/B`, `Dividend Yield`, `ROCE`, `ROE`, `Face Value`, `Book Value per Share`

Normalize keys: lowercase, replace spaces and `/` with `_`.

#### C5. Peer Comparison — `section id="peers"`, first `<table>`

Up to 8 peer companies. Typical columns:
`Company Name`, `CMP`, `P/E`, `Market Cap`, `Sales (TTM)`, `Net Profit`, `ROCE`, `Promoter Holding %`

Follow `<a>` tag for company name; plain text for numeric values.

#### C6. Shareholding Pattern — `section id="shareholding"`, `class="data-table"`

Quarterly data, last 6–8 quarters. Categories:

| Category | Description |
|---|---|
| `Promoters %` | Direct promoter holding |
| `FII / FPI %` | Foreign institutional investors |
| `DII %` | Domestic institutions (MF + Insurance) |
| `Public %` | Retail and HNI |

Derived signals:
- `promoter_pledge_pct` — extract from sub-row if disclosed
- `fii_trend` — `"rising"` / `"falling"` / `"stable"` over last 3 quarters
- `dii_trend` — `"rising"` / `"falling"` / `"stable"` over last 3 quarters

---

### SOURCE D — NSE Archives Bhavcopy ZIP (Fallback OHLCV — Always Public, No Auth)

**Use only when Source A (yfinance) AND Source B6 (NSE REST OHLCV) both fail.**
Cap at **125 trading days (~6 months)** to avoid very slow day-by-day loops.

**URL pattern:**
```
https://archives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip
```

**CSV columns used:**

| Column | Description |
|---|---|
| `TckrSymb` | Ticker symbol — match bare symbol, strip whitespace |
| `SctySrs` | Must equal `"EQ"` to filter equity series only |
| `OpnPric` | Open price |
| `HghPric` | High price |
| `LwPric` | Low price |
| `ClsPric` | Close price |
| `TtlTradgVol` | Total traded volume (shares) |

Assemble into a DataFrame sorted by date ascending, same schema as Source A OHLCV.

---

## SECTION 3 — INDICATORS COMPUTED FROM OHLCV

All indicators are computed from the OHLCV DataFrame produced by Source A, B6, or D.

**Input:** pandas DataFrame, columns `[open, high, low, close, volume]`, `DatetimeIndex` ascending.
**Convention:** `[-1]` = today's (latest) bar, `[-2]` = previous bar.

---

### Price References

```
price            = close[-1]
prev_close       = close[-2]
daily_change     = price - prev_close
daily_change_pct = (daily_change / prev_close) × 100
```

---

### Moving Averages (Simple)

```
ma20  = SMA(close, 20)[-1]
ma50  = SMA(close, 50)[-1]
ma200 = SMA(close, 200)[-1]
```

**Structure flags:**

| Flag | Condition |
|---|---|
| `price_above_ma20` | `price > ma20` |
| `price_above_ma50` | `price > ma50` |
| `price_above_ma200` | `price > ma200` |
| `ma_confluence_up` | `price > ma50` AND `ma50 > ma200` |
| `super_confluence` | `price > ma20 > ma50 > ma200` |
| `stage2_uptrend` | `price > ma200` AND `ma50 > ma200` |

---

### 52-Week and 50-Day Range

```
high_52w            = max(high[-252:])
low_52w             = min(low[-252:])
high_50d            = max(high[-50:])
close_above_50d_high = close[-1] > high_50d
close_at_52w_high    = close[-1] >= high_52w × 0.98   (within 2% of 52W high)
week52_position      = int(((price - low_52w) / (high_52w - low_52w)) × 100)
```

> `week52_position`: 0 = at 52W low, 100 = at 52W high

---

### Volume Indicators

```
vol_sma20       = SMA(volume, 20)[-1]
vol_sma7        = SMA(volume, 7)[-1]
volume_ratio    = volume[-1] / vol_sma20
vol_above_1_5x  = volume[-1] > vol_sma20 × 1.5
vol_above_2x    = volume[-1] > vol_sma20 × 2.0
vol_above_sma7  = volume[-1] > vol_sma7
volume_dry      = volume[-1] < vol_sma20 × 0.7
```

---

### RSI (Wilder's Smoothing, Period = 14)

```
RS  = avg_gain / avg_loss  over 14 periods (use EWM for smoothing after first 14 bars)
RSI = 100 - (100 / (1 + RS))

rsi            = RSI[-1]
rsi_3d_ago     = RSI[-4]
rsi_sma9       = SMA(RSI_series, 9)[-1]
rsi_above_55   = rsi > 55
rsi_above_60   = rsi > 60
rsi_above_68   = rsi > 68
rsi_below_40   = rsi < 40
rsi_rising     = rsi > rsi_3d_ago
rsi_ma_cross_bull = RSI[-1] > rsi_sma9[-1] AND RSI[-2] <= rsi_sma9[-2]
```

---

### MACD (12, 26, 9)

```
ema12           = close.ewm(span=12, adjust=False).mean()
ema26           = close.ewm(span=26, adjust=False).mean()
macd_line       = ema12 - ema26
signal_line     = macd_line.ewm(span=9, adjust=False).mean()
macd_hist       = macd_line - signal_line

macd_bullish_cross = macd_line[-1] > signal_line[-1] AND macd_line[-2] <= signal_line[-2]
macd_bearish_cross = macd_line[-1] < signal_line[-1] AND macd_line[-2] >= signal_line[-2]
macd_hist_positive = macd_hist[-1] > 0
macd_hist_negative = macd_hist[-1] < 0
```

---

### ATR (True Range, Period = 14)

```
true_range     = max(high - low, abs(high - prev_close), abs(low - prev_close))
atr14          = true_range.ewm(span=14, adjust=False).mean()[-1]
body           = abs(close[-1] - open[-1])
body_above_atr14 = body > atr14
```

---

### Bollinger Bands (20, 2σ)

```
bb_mid         = SMA(close, 20)
bb_std         = rolling std of close, window=20
bb_upper       = bb_mid + 2 × bb_std
bb_lower       = bb_mid - 2 × bb_std
bb_width       = (bb_upper - bb_lower) / bb_mid          (normalized bandwidth)
bb_width_sma20 = SMA(bb_width, 20)
bb_squeeze     = bb_width[-1] < bb_width_sma20[-1] × 0.75
```

---

### Keltner Channel (EMA 20, 1.5 × ATR)

```
kc_mid         = EMA(close, 20)
kc_upper       = kc_mid + 1.5 × atr14
kc_lower       = kc_mid - 1.5 × atr14
```

---

### TTM Squeeze (Lazybear Method)

```
squeeze_on     = bb_lower[-1] > kc_lower[-1] AND bb_upper[-1] < kc_upper[-1]

ttm_squeeze_fired     = squeeze was on for ≥3 consecutive bars, is now off
ttm_momentum_positive = linear regression of (close - midpoint of BB/KC range) > 0
```

---

### Parabolic SAR (step = 0.02, max = 0.20)

```
Compute standard PSAR series.
psar_bullish_flip = psar[-1] < close[-1] AND psar[-2] > close[-2]
psar_bearish_flip = psar[-1] > close[-1] AND psar[-2] < close[-2]
```

---

### Money Flow Index (MFI, Period = 14)

```
typical_price  = (high + low + close) / 3
raw_mf         = typical_price × volume
positive_mf    = sum of raw_mf where typical_price > prev typical_price (14 bars)
negative_mf    = sum of raw_mf where typical_price < prev typical_price (14 bars)
mfi            = 100 - (100 / (1 + positive_mf / negative_mf))
mfi_above_68   = mfi[-1] > 68
```

---

### CCI (Commodity Channel Index, Period = 20)

```
typical_price  = (high + low + close) / 3
tp_sma20       = SMA(typical_price, 20)
mean_deviation = SMA(abs(typical_price - tp_sma20), 20)
cci            = (typical_price - tp_sma20) / (0.015 × mean_deviation)
cci_above_110  = cci[-1] > 110
```

---

### Aroon (Period = 25)

```
aroon_up       = ((25 - bars_since_25d_high) / 25) × 100
aroon_down     = ((25 - bars_since_25d_low)  / 25) × 100
bullish_aroon_cross = aroon_up[-1] > aroon_down[-1] AND aroon_up[-2] <= aroon_down[-2]
```

---

### Candlestick Patterns

**Single-bar derived values:**

```
body        = abs(close[-1] - open[-1])
upper_wick  = high[-1] - max(open[-1], close[-1])
lower_wick  = min(open[-1], close[-1]) - low[-1]
candle_range = high[-1] - low[-1]
```

**Flags:**

| Flag | Condition |
|---|---|
| `is_bullish_candle` | `close > open` AND `body > 0.3 × candle_range` |
| `gap_up` | `open[-1] > high[-2]` |
| `inside_bar` | `high[-1] < high[-2]` AND `low[-1] > low[-2]` |
| `nr4` | today's range = narrowest of the last 4 bars |
| `close_up_3d` | `close[-1] > close[-2] > close[-3]` |
| `bullish_candle_pattern` | Hammer OR Bullish Engulfing OR Morning Star OR Dragonfly Doji |
| `bearish_candle_pattern` | Shooting Star OR Bearish Engulfing OR Evening Star |

**Pattern definitions:**

- **Hammer:** `lower_wick > 2 × body` AND `close > open` AND `upper_wick < body`
- **Bullish Engulfing:** prior bar bearish + today's body fully engulfs prior body, today bullish
- **Shooting Star:** `upper_wick > 2 × body` AND `open > close` AND `lower_wick < body`
- **Bearish Engulfing:** prior bar bullish + today's body fully engulfs prior body, today bearish

---

### Anchored VWAP (Anchored from 52-Week Low Date)

```
Locate the index date of low_52w in the OHLCV DataFrame.
From that date forward:
  avwap_52w_low   = cumsum(typical_price × volume) / cumsum(volume)   at [-1]
  price_above_avwap = price > avwap_52w_low
```

---

### Volume Profile — Point of Control (POC)

```
Use last 252 bars (≈1 year).
Bin the price range (low to high) into 50 equal buckets.
For each bar, assign volume to the bucket containing that bar's close.
poc_price        = midpoint of the bucket with the highest cumulative volume
price_above_poc  = price > poc_price
```

---

## SECTION 3B — FUNDAMENTAL METRICS DERIVED AFTER FETCHING

These are computed from Source A and Source C data — not from OHLCV.

### From yfinance `.info`

| Metric | Derivation |
|---|---|
| `market_cap_cr` | `marketCap / 1e7` |
| `pe` | `trailingPE` |
| `pbv` | `priceToBook` |
| `roe_pct` | `returnOnEquity × 100` |
| `div_yield_pct` | `dividendYield × 100` |
| `beta` | `beta` |
| `eps_ttm` | `trailingEps` |
| `book_value` | `bookValue` |
| `debt_equity` | `debtToEquity / 100` |
| `current_ratio` | `currentRatio` |

### From screener.in (10-year P&L trend)

| Metric | Derivation |
|---|---|
| `revenue_growth_3y` | CAGR of Revenue over last 3 years (%) |
| `profit_growth_3y` | CAGR of Net Profit over last 3 years (%) |
| `opm_avg_3y` | Average Operating Profit Margin, last 3 years (%) |
| `operating_cf_latest` | Cash from Operating Activity, most recent year (₹ Cr) |
| `free_cash_flow` | Operating CF + Investing CF (₹ Cr) |
| `fcf_to_profit` | Free Cash Flow / Net Profit — >0.8 = high-quality earnings |

### From screener.in (shareholding)

| Metric | Derivation |
|---|---|
| `promoter_holding_pct` | Latest Promoters % |
| `fii_holding_pct` | Latest FII / FPI % |
| `dii_holding_pct` | Latest DII % |
| `public_holding_pct` | Latest Public % |
| `fii_trend` | `"rising"` / `"falling"` / `"stable"` — last 3 quarters |
| `dii_trend` | `"rising"` / `"falling"` / `"stable"` — last 3 quarters |

### From NSE Source B

| Metric | Derivation |
|---|---|
| `delivery_pct_avg` | 30-day average delivery % |
| `delivery_pct_latest` | Most recent day's delivery % |
| `fo_eligible` | `True` / `False` |
| `index_membership` | List of index strings |
| `asm_gsm_stage` | `0–6` (0 = clean) |
| `has_bulk_deals` | `True` if any bulk deals in last 30 days |
| `insider_net_action` | `"buying"` / `"selling"` / `"none"` |

---

## SECTION 3C — FINAL MERGED SCHEMA PER STOCK

After fetching all 4 sources, merge into one flat dict per stock:

```python
{
    # From watchlist file
    "ticker":               "RELIANCE",
    "cap_tier":             "Large",
    "sector_file":          "Energy",

    # Identity (yfinance)
    "name":                 "Reliance Industries Ltd",
    "sector_yf":            "Energy",
    "exchange":             "NSE",
    "description":          "...",

    # Price (yfinance)
    "price":                2850.45,
    "prev_close":           2815.20,
    "daily_change_pct":     1.25,
    "market_cap_cr":        1930000,
    "volume":               8500000,
    "volume_ratio":         1.85,
    "week52_high":          3217.90,
    "week52_low":           2220.35,
    "week52_position":      70,

    # Fundamentals (yfinance)
    "pe":                   22.4,
    "pbv":                  2.1,
    "roe_pct":              18.3,
    "div_yield_pct":        0.45,
    "beta":                 1.1,
    "eps_ttm":              127.3,
    "book_value":           1356.8,
    "debt_equity":          0.38,
    "current_ratio":        1.2,

    # NSE-specific
    "isin":                 "INE002A01018",
    "fo_eligible":          True,
    "index_membership":     ["NIFTY 50", "NIFTY 100", "NIFTY 500"],
    "asm_gsm_stage":        0,
    "delivery_pct_avg":     54.2,
    "delivery_pct_latest":  58.1,
    "has_bulk_deals":       False,
    "insider_net_action":   "none",

    # Screener.in
    "promoter_holding_pct": 50.3,
    "fii_holding_pct":      24.1,
    "dii_holding_pct":      14.2,
    "public_holding_pct":   11.4,
    "fii_trend":            "rising",
    "dii_trend":            "stable",
    "revenue_growth_3y":    12.4,
    "profit_growth_3y":     18.7,
    "opm_avg_3y":           17.2,
    "free_cash_flow":       42000,
    "fcf_to_profit":        0.87,

    # Computed indicators (from OHLCV — Section 3)
    "ma20":                 2810.0,
    "ma50":                 2755.0,
    "ma200":                2630.0,
    "rsi":                  62.4,
    "macd_hist":            14.2,
    "atr14":                52.3,
    "volume_ratio":         1.85,
    "price_above_ma20":     True,
    "price_above_ma50":     True,
    "price_above_ma200":    True,
    "ma_confluence_up":     True,
    "super_confluence":     False,
    "stage2_uptrend":       True,
    "close_above_50d_high": True,
    "close_at_52w_high":    False,
    "vol_above_1_5x":       True,
    "vol_above_2x":         False,
    "vol_above_sma7":       True,
    "volume_dry":           False,
    "rsi_above_55":         True,
    "rsi_above_60":         True,
    "rsi_above_68":         False,
    "rsi_below_40":         False,
    "rsi_rising":           True,
    "macd_bullish_cross":   False,
    "macd_hist_positive":   True,
    "body_above_atr14":     False,
    "bb_squeeze":           False,
    "ttm_squeeze_fired":    False,
    "psar_bullish_flip":    False,
    "is_bullish_candle":    True,
    "gap_up":               False,
    "inside_bar":           False,
    "nr4":                  False,
    "close_up_3d":          True,
    "bullish_candle_pattern": False,
    "bearish_candle_pattern": False,
    "mfi_above_68":         False,
    "cci_above_110":        False,
    "bullish_aroon_cross":  False,
    "vcp_pattern":          False,
    "price_above_avwap":    True,
    "price_above_poc":      True,

    # Raw data kept for downstream use
    "ohlcv":                "<DataFrame: open/high/low/close/volume>",
    "financials": {
        "income":    {"FY24": {...}, "FY23": {...}, "FY22": {...}, "FY21": {...}},
        "balance":   {"FY24": {...}, "FY23": {...}, "FY22": {...}, "FY21": {...}},
        "cashflow":  {"FY24": {...}, "FY23": {...}, "FY22": {...}, "FY21": {...}}
    },
    "shareholding":  {"Promoters": {"Jun 2024": 50.3, ...}, "FII": {...}, ...},
    "peers":         [{"name": "...", "PE": "...", ...}, ...]
}
```

---

## API Rate Limits and Best Practices

| Source | Limit | Safe Pattern |
|---|---|---|
| yfinance (single ticker) | Soft — gets blocked if too aggressive | `time.sleep(0.5)` between calls |
| yfinance (batch) | Better for bulk fetches | `yf.download(["A.NS","B.NS"], period="1y")` |
| NSE REST API | ~5–10 req/sec; Akamai WAF blocks bots | Single session, `time.sleep(0.5)` per call |
| screener.in | Strict — 429 if too fast | `time.sleep(1.5)` per URL |
| NSE Archives (Bhavcopy) | Public, no auth, no hard limit | Slow — one ZIP per day; cap at 125 days |

**NSE trading hours note:** NSE API returns stale or empty data between market close (3:30 PM IST) and next open (9:00 AM IST) for some endpoints. Pre-market and post-market fetches may need retry logic.
