# Screener.in fundamentals: session notes

**Session by:** Santosh

---

## Market cap

- Market Cap = Number of Shares × Current Price. It's the price of the entire company at the current market price.
- Market Cap and Current Price are the same metric at different scales. Market Cap is company-level, Current Price is per-share.
- Same logic applies to: Book Value (total) vs Book Value per Share, Equity Capital vs Face Value.
- Smaller market cap companies have higher growth potential. A ₹5,000 Cr company can realistically 5x. A ₹2.38 lakh Cr company doing the same is far harder.

## Shareholding pattern

- Promoters, FII, DII, Government, Public. This shows how the market cap pie is distributed.
- Public holding ideally below ~30%. Higher than that may indicate HNI presence (anyone holding >1% of market cap).

## Corporate actions: splits, bonuses, dividends

- None of these change Market Cap. They rearrange the formula (shares go up, price adjusts down, or vice versa) but no new wealth is created.
- **Stock Split:** shares increase, price decreases proportionally. Net effect zero.
- **Bonus:** shares carved from Reserves and added to Equity Capital. Price adjusts. Net effect zero.
- **Dividend:** stock price adjusts down by the dividend amount on ex-date. Not an arbitrage opportunity.

## Face Value

- Face Value = Equity Capital ÷ Number of Shares. The original issue price of the share.
- No practical significance for investing decisions.
- Trap: "50% dividend" is 50% of Face Value (e.g., ₹5 on a ₹10 face value), not 50% of the current market price.

## Book Value

- Book Value = Equity Capital + Reserves. What shareholders would theoretically receive on full liquidation.
- Calculated at historical cost, so almost always understated relative to current market value of assets (especially land).
- Current Price below Book Value is a rare and interesting signal, but not a mandatory filter. Many strong companies (Titan, etc.) will never trade below book.
- Book Value across industries cannot be compared. Capital-intensive businesses (manufacturing) naturally have high book values. Asset-light businesses (IT, fund management) have low ones. Different business models, different meaning.

## Replacement theory

- What would it cost to build this exact company from scratch today? If replacement cost is significantly above current Market Cap, the stock may be undervalued.

## Balance sheet

**Liabilities side:**
- Shareholder's Fund = Equity Capital + Reserves. Classified as liabilities because the company owes these to shareholders.
- Borrowings: long-term (>1 year) and short-term (<1 year).
- Lease liability (post Ind-AS) is rent reclassified as a liability on the balance sheet. Not the same as dangerous debt.
- Trade Payables, Customer Advances, Other Liabilities.

**Assets side:**
- Fixed Assets: land, buildings, machinery, equipment.
- Intangible Assets: brand value, patents, acquisition goodwill. Can swing wildly (HUL intangibles jumped from ₹500 Cr to ₹45,000 Cr after Horlicks acquisition). Don't weight these heavily.
- CWIP (Capital Work-in-Progress): assets under construction, not yet generating revenue. Moves to Fixed Assets once operational.
- Investments: FDs, mutual funds, equity held by the company.
- Current Assets: inventories, trade receivables, cash & equivalents, loans & advances.

## Debt-to-Equity ratio

- D/E = Total Borrowings ÷ Shareholder's Fund.
- Net Debt is the more useful metric: Borrowings minus (Cash + Liquid Investments).
- Negative Net Debt = the company has more cash than debt. Virtually debt-free.
- Debt is not inherently bad. If investments earn more than the borrowing cost, the debt is productive.
- Custom Net Debt-to-Equity ratio can be created on Screener.in under Edit Ratios.

## PE ratio

- PE = Market Cap ÷ Net Profit. Tells you how many years of current profit it would take to equal the market cap.
- Misleading in isolation because profits grow. A PE of 25 does not mean 25-year recovery if profit doubles every 4-5 years.
- Compare PE through profit doubling speed, not raw numbers. A PE 37 company doubling profit in 4 years can be better value than a PE 61 company taking 9 years.
- **PE spike from raw material cost pressure:** temporary. Margins compress, profit drops, PE inflates. Once input costs normalize, everything reverts. Often an opportunity. Verify through quarterly earnings transcripts on Screener (Documents tab).
- **PE spike from exceptional income:** misleading. One-time gains (asset sales, business divestments) inflate profit for a single quarter. Next quarter it disappears. Don't buy based on this.
- Same logic in reverse: a one-time exceptional loss inflating PE is also temporary. Don't panic-sell.

## Profit & Loss: what to check

- Revenue growth: is top-line consistently growing?
- Operating Margin (Operating Profit ÷ Revenue): is it stable or compressing?
- Net Profit vs Operating Profit: is net profit driven by actual operations or by exceptional/other income?
- Use quarterly data for trends, annual data to smooth noise.

## Fixed asset growth as a profit signal

- Expanding fixed assets (machinery, plants, land) signals investment in future capacity. When Asian Paints tripled fixed assets, profit roughly tripled. Track this as a leading indicator.

## Technical-fundamental alignment

- Conviction is highest when a chart setup (breakout, cup & handle) aligns with a fundamental catalyst (capacity expansion, management guidance, margin recovery). Neither alone gives the same confidence.

---

## Checklist

**Must-haves:**
- Revenue growth trending up
- Operating margin stable
- Net Debt position healthy
- Promoter holding steady or increasing
- No exceptional income distorting numbers

**Good-to-haves:**
- CMP below Book Value
- PE below industry median
- Fixed assets expanding
- Market Cap / Sales below median
- EV/EBITDA below median

**Red flags:**
- Interest costs growing faster than revenue
- Borrowings up without corresponding asset or revenue growth
- Single quarter profit carried by exceptional income
- Unusual tax payment patterns

---

## Practical tips to keep in mind

- Screener.in data originates from company-appointed CAs. Manipulation can happen. Portfolio sizing is the safety net.
- Allocation caps: Large Cap 5%, Mid Cap 3%, Small Cap 1.5% per stock.
- GTT orders on Zerodha get auto-cancelled on any corporate action (split, bonus, dividend). Re-place at the adjusted level.
- TradingView: always keep "Adjusted" toggle ON. Otherwise historical price levels (support/resistance) will be incorrect.
- Industry PE, Cash Flow statement, and most Ratios tabs on Screener are not used in this approach.
- When management makes forward commitments (e.g., Ambani's EBITDA doubling target), track progress quarter by quarter. Price dips while the trajectory holds = opportunity.
