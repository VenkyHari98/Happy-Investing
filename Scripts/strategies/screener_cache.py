"""
Screener.in data fetcher and cache for NSE tickers.

Fetches consolidated P&L, balance sheet, ratios, and shareholding data directly
from Screener.in company pages. Cached weekly per-ticker in:
    Scripts/strategies/.store/screener/{TICKER}_screener.json

WHY: yfinance has poor coverage for insurance / NBFC / financial holding companies
(no standard EPS → no PE). Screener.in computes PE from consolidated financials
for ALL listed stocks. Also provides promoter pledging % that yfinance never has.

SETUP:
    1. pip install requests beautifulsoup4
    2. Create screener_credentials.json in the project root:
       { "username": "your@email.com", "password": "yourpassword" }
       (This file is gitignored — never commit credentials.)

BATCH PULL (CLI):
    python screener_cache.py --watchlist "Source Data/Watchlist/F40.txt"
    python screener_cache.py --watchlist "Source Data/Watchlist/F40.txt,Source Data/Watchlist/E40.txt,Source Data/Watchlist/S200.txt"
    python screener_cache.py --watchlist ... --force   # re-fetch even if fresh

USAGE IN CODE:
    from screener_cache import load_screener_data, get_screener_data
    data = load_screener_data("RELIANCE")        # cache only, no network
    data = get_screener_data("RELIANCE", client) # fetch if stale

DATA DICT KEYS (per ticker):
    pe_ttm              float | None   — current trailing PE
    book_value          float | None   — book value per share (₹)
    price_to_book       float | None   — current P/B
    roce_latest         float | None   — latest ROCE %
    roe_latest          float | None   — latest ROE %
    pledged_pct_latest  float | None   — latest promoter pledge %
    eps_annual          dict           — {period_label: float}  e.g. "Mar 2024": 115.2
    opm_pct             dict           — annual OPM%
    roce_annual         dict           — annual ROCE%
    roe_annual          dict           — annual ROE%
    sales_cr            dict           — annual Revenue (₹ Cr)
    net_profit_cr       dict           — annual Net Profit (₹ Cr)
    promoter_pct        dict           — quarterly promoter holding %
    pledged_pct         dict           — quarterly pledge %
    net_de_annual       dict           — computed net D/E from balance sheet
    fetched_date        str            — ISO date of last fetch
    consolidated        bool           — True if consolidated data was used
"""

import argparse
import json
import re
import time
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

try:
    from bs4 import BeautifulSoup
    _BS4 = True
except ImportError:
    _BS4 = False

# ── Config ─────────────────────────────────────────────────────────────────

SCREENER_BASE    = "https://www.screener.in"
_STORE_DIR       = Path(__file__).parent / ".store" / "screener"
_DEFAULT_CREDS   = Path(__file__).resolve().parent.parent.parent / "screener_credentials.json"
CACHE_AGE_DAYS   = 7
REQUEST_DELAY    = 0.8   # seconds between requests — be polite to Screener.in


# ── Number parsing ─────────────────────────────────────────────────────────

def _num(s: str) -> Optional[float]:
    """'1,23,456.7' → 123456.7 · '18.5 %' → 18.5 · None if non-numeric."""
    if not s:
        return None
    cleaned = re.sub(r"[₹,%\s]", "", str(s)).replace(",", "").strip()
    if cleaned in ("", "-", "--", "NA", "N/A", "0"):
        return None
    try:
        v = float(cleaned)
        return v if v != 0 else None
    except ValueError:
        return None


# ── HTML table parser ──────────────────────────────────────────────────────

def _parse_table(section) -> Dict[str, Dict[str, Optional[float]]]:
    """
    Parse a Screener.in <section> containing a data-table.
    Returns {row_label: {period: value, ...}, ...}
    Headers (columns) are period labels like "Mar 2024", "Jun 2024", "TTM".
    """
    table = section.find("table")
    if not table:
        return {}

    thead = table.find("thead")
    headers: List[str] = []
    if thead:
        for th in thead.find_all("th"):
            headers.append(th.get_text(strip=True))

    result: Dict[str, Dict[str, Optional[float]]] = {}
    tbody = table.find("tbody")
    if not tbody:
        return result

    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        # First cell = row label; strip trailing annotation characters (+, -, %)
        label = cells[0].get_text(strip=True).rstrip(" +-")
        row: Dict[str, Optional[float]] = {}
        for i, td in enumerate(cells[1:], start=1):
            if i < len(headers) and headers[i]:
                row[headers[i]] = _num(td.get_text(strip=True))
        result[label] = row

    return result


def _top_ratios(soup) -> Dict[str, Optional[float]]:
    """Extract key metrics from the #top-ratios list (PE, Book Value, ROCE, ROE, etc.)."""
    out: Dict[str, Optional[float]] = {}
    ul = soup.find("ul", id="top-ratios")
    if not ul:
        return out
    for li in ul.find_all("li"):
        name = li.find("span", class_="name")
        val  = li.find("span", class_="number")
        if name and val:
            out[name.get_text(strip=True).lower().strip()] = _num(val.get_text(strip=True))
    return out


def _series(table: Dict, *keys: str) -> Dict[str, float]:
    """Find the first matching row label and return its {period: value} dict (None filtered)."""
    for k in keys:
        if k in table:
            return {p: v for p, v in table[k].items() if v is not None}
    return {}


# ── Screener client ────────────────────────────────────────────────────────

class ScreenerClient:
    """Authenticated session to Screener.in for scraping company data."""

    def __init__(self, credentials_file: Path = _DEFAULT_CREDS):
        if not _BS4:
            raise ImportError(
                "beautifulsoup4 is required for Screener.in scraping.\n"
                "Install: pip install beautifulsoup4"
            )
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        })
        self._login(credentials_file)

    def _login(self, creds_file: Path) -> None:
        if not creds_file.exists():
            raise FileNotFoundError(
                f"Screener credentials not found at:\n  {creds_file}\n\n"
                'Create it with:\n  {"username": "you@email.com", "password": "yourpass"}'
            )
        with open(creds_file, encoding="utf-8") as f:
            creds = json.load(f)

        # Fetch login page to get CSRF token
        r = self.session.get(f"{SCREENER_BASE}/login/", timeout=15)

        # CSRF token can be in the form or in the cookie
        csrf = self.session.cookies.get("csrftoken", "")
        if not csrf:
            m = re.search(
                r'name=["\']csrfmiddlewaretoken["\'][^>]*value=["\'](.+?)["\']',
                r.text
            )
            if m:
                csrf = m.group(1)
        if not csrf:
            raise RuntimeError("Could not find CSRF token on Screener.in login page.")

        resp = self.session.post(
            f"{SCREENER_BASE}/login/",
            data={
                "username":            creds["username"],
                "password":            creds["password"],
                "csrfmiddlewaretoken": csrf,
                "next":                "/",
            },
            headers={"Referer": f"{SCREENER_BASE}/login/"},
            timeout=15,
            allow_redirects=True,
        )
        if "/login/" in resp.url:
            raise RuntimeError(
                "Screener.in login failed — check username/password in screener_credentials.json"
            )
        print("  ✓ Screener.in login successful")

    def _get(self, url: str) -> Optional["BeautifulSoup"]:
        try:
            r = self.session.get(url, timeout=20)
            if r.status_code == 200:
                return BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            print(f"    HTTP error {url}: {e}")
        return None

    def fetch_company_data(self, ticker: str) -> Optional[Dict[str, Any]]:
        """
        Fetch and parse all available financial data for an NSE ticker.
        Tries consolidated URL first, falls back to standalone.
        Returns None if the ticker is not found on Screener.in.
        """
        soup = None
        consolidated = True
        for suffix in ("/consolidated/", "/"):
            url = f"{SCREENER_BASE}/company/{ticker}{suffix}"
            s = self._get(url)
            if s and s.find("section", id="profit-loss"):
                soup = s
                consolidated = (suffix == "/consolidated/")
                break

        if soup is None:
            return None

        time.sleep(REQUEST_DELAY)

        # ── Current snapshot ────────────────────────────────────────────────
        top = _top_ratios(soup)

        # ── Financial tables ────────────────────────────────────────────────
        def _sec(sec_id: str) -> Dict:
            s = soup.find("section", id=sec_id)
            return _parse_table(s) if s else {}

        pl      = _sec("profit-loss")
        bs      = _sec("balance-sheet")
        ratios  = _sec("ratios")
        sh      = _sec("shareholding")

        # ── Extract named series ────────────────────────────────────────────
        sales_cr      = _series(pl, "Sales", "Revenue from operations", "Revenue")
        net_profit_cr = _series(pl, "Net Profit", "Profit after tax", "PAT")
        eps_annual    = _series(pl, "EPS in Rs", "EPS", "Diluted EPS")
        opm_pct       = _series(pl, "OPM %", "Operating Profit Margin")

        roce_annual   = _series(ratios, "ROCE %", "Return on capital employed %", "ROCE")
        roe_annual    = _series(ratios, "ROE %", "Return on equity %", "ROE")

        total_debt    = _series(bs, "Borrowings", "Total Borrowings")
        equity_cap    = _series(bs, "Equity Capital", "Share Capital")

        promoter_pct  = _series(sh, "Promoters", "Promoter", "Promoter & Promoter Group")
        pledged_pct   = _series(sh, "Pledge %", "Pledged %", "Pledging %",
                                 "% Pledged", "% of Promoter Shares Pledged")

        # Compute net D/E from balance sheet (total debt / equity capital)
        net_de: Dict[str, float] = {}
        for period in total_debt:
            d = total_debt.get(period)
            e = equity_cap.get(period)
            if d is not None and e and e > 0:
                net_de[period] = round(d / e, 2)

        # Latest pledged %: first (most recent) value in the quarterly series
        pledged_latest = next(iter(pledged_pct.values()), None) if pledged_pct else None

        return {
            "ticker":              ticker,
            "fetched_date":        date.today().isoformat(),
            "consolidated":        consolidated,
            # Current snapshot (top-ratios)
            "pe_ttm":              top.get("stock p/e"),
            "book_value":          top.get("book value"),
            "price_to_book":       top.get("price to book value"),
            "roce_latest":         top.get("roce"),
            "roe_latest":          top.get("roe"),
            "market_cap_cr":       top.get("market cap"),
            # P&L annual series (Cr = Crores)
            "sales_cr":            sales_cr,
            "net_profit_cr":       net_profit_cr,
            "eps_annual":          eps_annual,
            "opm_pct":             opm_pct,
            # Ratio series
            "roce_annual":         roce_annual,
            "roe_annual":          roe_annual,
            # Balance sheet
            "total_debt":          total_debt,
            "equity_capital":      equity_cap,
            "net_de_annual":       net_de,
            # Shareholding
            "promoter_pct":        promoter_pct,
            "pledged_pct":         pledged_pct,
            "pledged_pct_latest":  pledged_latest,
        }


# ── Cache helpers ──────────────────────────────────────────────────────────

def _cache_path(ticker: str) -> Path:
    return _STORE_DIR / f"{ticker}_screener.json"


def _is_fresh(ticker: str) -> bool:
    path = _cache_path(ticker)
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        fetched = date.fromisoformat(data.get("fetched_date", "2000-01-01"))
        return (date.today() - fetched).days < CACHE_AGE_DAYS
    except Exception:
        return False


def save_screener_data(ticker: str, data: Dict[str, Any]) -> None:
    _STORE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(ticker).write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def load_screener_data(ticker: str) -> Optional[Dict[str, Any]]:
    """Load cached Screener.in data for ticker. Returns None if not yet fetched."""
    path = _cache_path(ticker)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def get_screener_data(
    ticker: str,
    client: Optional[ScreenerClient] = None,
    force: bool = False,
) -> Optional[Dict[str, Any]]:
    """
    Return Screener.in data for ticker.
    Uses cache when fresh. Fetches via client when stale or missing.
    Without a client, always returns cache (or None if never fetched).
    """
    if not force and _is_fresh(ticker):
        return load_screener_data(ticker)
    if client is None:
        return load_screener_data(ticker)
    data = client.fetch_company_data(ticker)
    if data:
        save_screener_data(ticker, data)
    return data


# ── Batch pull ─────────────────────────────────────────────────────────────

def run_batch(
    tickers: List[str],
    credentials_file: Path = _DEFAULT_CREDS,
    force: bool = False,
) -> Tuple[int, List[str]]:
    """Fetch Screener.in data for all tickers, skipping fresh-cached ones."""
    _STORE_DIR.mkdir(parents=True, exist_ok=True)

    fresh    = [t for t in tickers if not force and _is_fresh(t)]
    to_fetch = [t for t in tickers if t not in fresh]

    print(f"\nScreener.in batch pull")
    print(f"  Fresh (cached)  : {len(fresh)}")
    print(f"  To fetch        : {len(to_fetch)}")
    if not to_fetch:
        print("  Nothing to do — all data is fresh.\n")
        return len(fresh), []

    client  = ScreenerClient(credentials_file)
    ok, failed = 0, []

    for i, ticker in enumerate(to_fetch, 1):
        print(f"  [{i:>3}/{len(to_fetch)}] {ticker:<20}", end=" ", flush=True)
        try:
            data = client.fetch_company_data(ticker)
            if data:
                save_screener_data(ticker, data)
                ok += 1
                pe       = data.get("pe_ttm")
                pledged  = data.get("pledged_pct_latest")
                roce     = data.get("roce_latest")
                consol   = "C" if data.get("consolidated") else "S"
                print(f"OK [{consol}]  PE={pe}  ROCE={roce}%  Pledged={pledged}%")
            else:
                failed.append(ticker)
                print("NOT FOUND on Screener.in")
        except Exception as e:
            failed.append(ticker)
            print(f"ERROR: {e}")

        time.sleep(REQUEST_DELAY)

    print(f"\n  Done: {ok} ok, {len(failed)} failed")
    if failed:
        print(f"  Failed: {failed}")
    return ok, failed


# ── CLI ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from f40_backtest_common import parse_watchlists

    parser = argparse.ArgumentParser(description="Fetch Screener.in fundamental data for all watchlist tickers")
    parser.add_argument(
        "--watchlist", required=True,
        help="Comma-separated watchlist file paths. e.g.: 'Source Data/Watchlist/F40.txt,Source Data/Watchlist/E40.txt'"
    )
    parser.add_argument(
        "--credentials", default=str(_DEFAULT_CREDS),
        help="Path to screener_credentials.json (default: project root)"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-fetch all tickers even if cache is fresh (less than 7 days old)"
    )
    parser.add_argument(
        "--ticker", default=None,
        help="Fetch a single ticker only (for testing)"
    )
    args = parser.parse_args()

    if args.ticker:
        tickers = [args.ticker.upper()]
    else:
        wl_files = [Path(p.strip()).resolve() for p in args.watchlist.split(",")]
        stocks   = parse_watchlists(wl_files)
        tickers  = list(stocks.keys())
        print(f"Tickers from watchlists: {len(tickers)}")

    run_batch(tickers, Path(args.credentials), force=args.force)
