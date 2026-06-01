# Happy Investing — F40 Strategy Dashboard

Interactive dark-themed web dashboard for value trading on the F40 stock universe (NSE India).

## Strategy Philosophy
- **Entry**: At or near the rolling 52-week low
- **Exit**: Only when price hits the fixed 52-week high (recorded at entry time)
- **No stop-loss. No time-based exit.** Hold until target.
- **Multi-entry**: When a stock revisits a new 52W low (≥8% below last entry), open an additional position with its own fixed exit target
- **ABCD averaging**: Downward-averaging tranches at −10% steps from any entry

## Project Structure

```
Happy Investing/
├── Scripts/
│   ├── Instructions/           # Strategy rules (canonical reference docs)
│   │   ├── f40_strategies.md
│   │   ├── abcd_strategy.md
│   │   └── envelope_strategies.md
│   └── strategies/             # Python backtest engines and scanner
│       ├── f40_backtest_common.py    # Shared data classes and helpers
│       ├── f40_backtest_52w.py       # 52W Low→High backtest (main)
│       ├── f40_backtest_envelope.py  # Envelope strategy backtest
│       ├── f40_backtest_abcd.py      # ABCD averaging backtest
│       └── f40_opportunity_scanner.py # Live opportunity scanner
├── Source Data/
│   └── Watchlist/
│       ├── F40.txt             # 40 fundamentally strong stocks (primary universe)
│       ├── E40.txt             # Extended watchlist
│       └── S200.txt            # S200 universe
├── web/
│   ├── index.html              # Dashboard entry point
│   ├── styles.css              # Dark theme styles
│   ├── app.js                  # All frontend logic
│   ├── build_data.py           # Copies generated data into web/data/
│   ├── start_dashboard.py      # Starts local HTTP server
│   ├── start_dashboard.ps1     # PowerShell launcher
│   └── start_dashboard.bat     # Windows batch launcher
└── Live Classes/
    └── May Cohort/Notes/       # Session notes and strategy learning materials
```

> `Source Data/Downloaded Data/` and `web/data/` are **not committed** — they are generated locally by running the scripts below.

---

## Setup (new machine)

### 1. Clone the repo
```bash
git clone https://github.com/VenkyHari98/Happy-Investing.git
cd "Happy Investing"
```

### 2. Install Python dependencies
Requires **Python 3.11+**
```bash
pip install -r requirements.txt
```

### 3. Run the 52W backtest (downloads 10 years of data from yfinance)
```bash
cd "Happy Investing"
python Scripts/strategies/f40_backtest_52w.py \
  --watchlist "Source Data/Watchlist/F40.txt" \
  --output "Source Data/Downloaded Data/backtest_52w" \
  --years 10
```
Takes 3–5 minutes. Fetches NSE/BSE data via yfinance.

### 4. Run the opportunity scanner (downloads recent 2 years)
```bash
python Scripts/strategies/f40_opportunity_scanner.py \
  --watchlist "Source Data/Watchlist/F40.txt" \
  --output-root "Source Data/Downloaded Data/current_setup"
```

### 5. Copy data to web folder
```bash
cd web
python build_data.py
```

### 6. Start the dashboard
```bash
python start_dashboard.py
```
Open `http://localhost:8080` in your browser.

---

## Dashboard Features

### 52W Low → High page
| Sub-tab | What it shows |
|---|---|
| **Opportunity Scanner** | F40 stocks currently near their 52W low, ABCD tranche levels (A/B/C/D), potential gain to 52W high, full proximity table with sector filter |
| **Stock Analysis** | Left panel: stock list with sector filter · Right panel: metric cards, open positions with fixed targets (amber), interactive SVG chart (price + 52W bands + 200 DMA + entry/exit markers + hover tooltip), completed and open trade log |

### Coming soon
- Envelope Strategy page
- ABCD Averaging page
- Combined Scanner (stocks where 2+ strategies align)
- Portfolio Overview (cross-strategy consolidated view)

---

## Backtest Parameters

| Parameter | Default | Description |
|---|---|---|
| `--years` | 10 | Years of historical data |
| `--portfolio-value` | 100,000 | Simulated portfolio size (₹) |
| `--slippage` | 0.10 | Slippage per side (%) |
| `--max-concurrent` | 4 | Max simultaneous entries per stock |
| `--new-entry-threshold` | 8.0 | Min % below last entry to open a new position |

---

## F40 Watchlist — Sector & Cap Breakdown

| Sector | Stocks |
|---|---|
| Banking | AXISBANK, HDFCBANK, ICICIBANK, KOTAKBANK, SBIN |
| FMCG | HINDUNILVR, ITC, NESTLEIND, COLPAL, DABUR, MARICO, PGHH, GILLETTE |
| IT | HCLTECH, INFY, TCS |
| Financial Services | BAJAJFINSV, BAJAJHLDNG, BAJFINANCE, HDFCAMC, NAM-INDIA |
| Insurance | HDFCLIFE, ICICIGI, ICICIPRULI |
| Paints | ASIANPAINT, BERGEPAINT |
| Pharma | ABBOTINDIA, GLAXO, PFIZER, SANOFI |
| Automobile | BAJAJ-AUTO, MARUTI |
| Consumer Electricals | HAVELLS, VOLTAS |
| Engineering | LT |
| Oil & Gas | RELIANCE |
| Chemicals | PIDILITIND |
| Jewellery & Watches | TITAN |
| Footwear | BATAINDIA |
| Apparel | PAGEIND |

---

## Contributing
1. Fork the repo and create a feature branch
2. Run the backtest locally to regenerate data before testing
3. Open a pull request with a clear description of the change
