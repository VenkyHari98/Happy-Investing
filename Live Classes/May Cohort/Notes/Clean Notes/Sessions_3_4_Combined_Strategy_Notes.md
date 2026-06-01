# Sessions 3 & 4: Complete strategy reference (F40 and E40)

**Instructor:** Santosh
**Scope:** All strategies for F40 and E40 stock universes. Daily charts only. No stop-loss in any strategy.

---

## Foundation: 200 DMA as gravity line

- **200 DMA** = average of the last 200 trading days' close price. Roughly 11 months of data.
- Price oscillates around the 200 DMA like a sine wave. Goes above, comes back. Goes below, comes back. This pattern holds across decades and across stocks.
- This mean reversion behavior is the foundation of envelope, NOX, and SMA strategies.
- 200 DMA is the "sea level." Price below it = external pressure pushing the ball underwater. Price above it = ball floating naturally. When pressure is removed, the ball surfaces.

## Strategy priority

- **First priority:** Long envelope (best risk-reward, most tested).
- **Second priority:** NOX (best as a supporting signal combined with envelope).
- **Third priority:** 52-week high/low, support & resistance.
- **Backup strategies:** SMA, RHS/CWS, 10% correction ABCD. Good to know, not first to use. Reach for these when primary strategies don't give a signal but you see clear value.

---

## ABCD averaging system (applies across all strategies)

When a stock falls after your initial buy (A point), ABCD lets you average down without exceeding allocation limits.

**Drop zones (all measured from A point):**

| Stock type | A to B | A to C | A to D |
|-----------|--------|--------|--------|
| Large cap (F40) | 10% | 20% | 30% |
| Mid cap / Small cap | 15% | 30% | 45% |
| High-volatility stocks | 20% | 40% | 60% |

**Allocation per trade:**
- A trade: 2-3% (main entry)
- B trade: 1%
- C trade: 1%
- D trade: 1%

**Rules:**
- One trade per band at any time. If a B trade is open, no second B trade even if price re-enters the band.
- Once a trade is closed (sold), you can take a new trade if price re-enters that band.
- **Default sell targets:** B sells at A, C sells at B, D sells at C.
- *In crisis situations (COVID, war):* can hold all trades to main target X instead of cutting at the next band up.
- For **E40 stocks using SMA strategy:** skip the A trade entirely. Start from B, C, D only.

**FIFO note:** Zerodha calculates profit/loss using FIFO (first in, first out), which differs from how the trading journal tracks it. Your first two sells may show a "loss" in Zerodha's P&L because it matches them against the first buy at a higher price. In the trading journal, each trade is a separate line item with its own buy/sell/profit. End-game total profit is the same either way. Don't get confused by the P&L shown in the demat account. Only trust the trading journal.

---

## 1. Long envelope strategy (F40 only)

**Setup:** Indicator: Envelope. Length: 200. Percentage: 14. Daily chart.

**Buy:** When price touches or falls below the lower blue line.

**Sell:** 30% above buy price (horizontal line using Alt J) OR upper blue line, whichever is higher.
- If horizontal line is above upper blue: wait for horizontal.
- If upper blue is above horizontal: sell at upper blue.
- If upper blue is coming down while price approaches: use common sense. If upper blue gives 26% in 248 days vs waiting for 30% in 450+ days, capital rotation may be better.

**Allocation at A point:** depends on situation.
- Stock hasn't touched lower blue for years, no macro crisis: 3%.
- Uncertain if it will fall further: 2%.
- Crisis (COVID, war): 1-2%, keep maximum room for ABCD.

**No stop-loss.** If the stock falls, play ABCD. Position sizing (1.5% small cap, 3% mid cap, 5% large cap) is the protection.

**Worst case:** Some stocks drop 50-60% after entry. At 1.5% allocation, that's a small absolute loss. The stock will recover, but not soon. Accept it and wait.

## 2. Short envelope strategy (F40 only)

**When to use:** When a stock doesn't reach the lower blue line for extended periods (e.g., ICICI Bank post-COVID).

**Setup:** Same indicator (Envelope, 200, 14). Use the upper band range instead.

**Buy:** At the orange line (200 DMA) or when price dips below it.
**Sell:** At the upper blue line.

Returns are lower (15-20% per trade) but trades are more frequent. Useful for regular capital rotation or monthly cash flow.

**Instructor preference:** Long envelope is primary. Short envelope is a tool, not the main approach.

## 3. NOX divergence strategy (F40 only)

**Setup:** Indicator: Rob Booker NOX Divergence. Bars back: 200. RSI period: 14. Momentum: 20. Daily chart.

**What it does:** Trend reversal indicator. Combines RSI (strength/acceleration) and momentum (speed) to detect when a falling stock is decelerating and about to reverse.

**Lines:**
- Upward green line = buy signal.
- Downward red line = sell signal.
- Line length and starting point don't matter. Only the ending point matters.

**Buy:** When first upward line appears below 200 DMA. Buy next day.
**Sell:** When first downward line appears above 200 DMA.

**Rules:**
- Maximum 2 trades per cycle.
- Second trade only if price is 10%+ below first buy point AND a new NOX signal appears.
- When first red line comes above 200 EMA, close all positions.
- Prefer stocks at least **10% below 200 DMA** for better margin of safety. NOX standalone near 200 DMA gives low returns.

**Common sense override:** If the sell signal fires but your first trade is barely above buy price, keep it open. Only close the second trade. Each trade is a separate line item.

**Timing:** Do NOT check NOX during market hours (9:15-3:30). Lines form and disappear intraday. Only check after market close or on weekends.

**Best use:** Combined with envelope. When both signal buy simultaneously, conviction is highest.

## 4. 52-week high/low strategy (F40 only)

**Setup:** Indicator: 52 Week High Low. Inputs: 250 days. Remove basis line.

**Buy:** When price touches or nears the green line (52-week low).
**Sell:** When price touches or nears the red line (52-week high).

**Buy and sell points are ranges, not exact points:**
- Sell GTT: set 0.5-0.75% below the exact indicator value.
- Buy GTT: can set slightly below. If it doesn't trigger, no loss.
- Range: plus or minus 0.5% to 1%.

**Combining:** When 52-week low, envelope lower blue, and NOX all align on the same stock, it's the strongest possible buy signal.

## 5. SMA strategy (F40 + E40)

**Setup:** Three moving averages on daily chart:
- 200-day MA (red line)
- 50-day MA (green line)
- 20-day MA (blue line)
- Price line (purple/candle)

**Buy signal (Golden Cross):** When the order from top to bottom is: Red, Green, Blue, Price. Meaning all three MAs are above price in descending order, and price crosses up through them. Buy when the sequence Red > Green > Blue > Price forms.

**Sell signal (Death Cross):** Reverse order. Price crosses down through all three MAs. Red > Green > Blue > Price from bottom to top.

**Character of SMA:** This is a lagging indicator. Results are typically 6-17% per trade in normal conditions. In crash situations (COVID etc.), it can produce 24-82% returns.

**SMA is "good to learn, not first to use."** When envelope and NOX are available, use those. SMA is the fallback when no other strategy gives a signal but you see clear value in the stock.

**In F40:** Use SMA with full ABCD.
**In E40:** Use SMA with BCD only (skip the A trade). Start from B point. This is because SMA is a lagging indicator, and in E40 stocks (higher volatility), the A signal often comes too early. Waiting for B gives better entry.

**Practical use case:** Bajaj Housing Finance (E40) fell heavily from IPO. No envelope applies (E40 stock). SMA gave a signal, and BCD was used to average in. Target: either B to A, or extend to the full SMA sell signal for 30%+ returns.

## 6. Reverse Head & Shoulder / Cup With Handle (F40 + E40)

**Applicability:** F40 and E40. Not S200. No stop-loss. Daily chart.

**RHS and CWS are the same strategy, different pattern shape.** All rules are identical.

### Pattern identification

**Reverse Head & Shoulder:** Three points forming a "W" with a deeper middle dip (head) and two shallower dips (shoulders) on either side.

**Cup With Handle:** A "U" shaped dip (cup) followed by a smaller dip (handle) on the right side. Can have multiple handles. Depth of handle doesn't matter. Only depth of cup matters.

### Neckline rules

- Draw a horizontal line connecting the peaks between the dips. This is the **neckline**.
- Neckline must be horizontal (not slanting). No trend lines.
- Neckline should not cross the **body** of any green candle during the pattern formation. It can cross red candle bodies and wicks. The logic: green candle body = bullish close. If the neckline is cutting through green candle bodies, the resistance level isn't clean.

### Target calculation

1. Measure the **percentage depth** from neckline to the lowest point (head of RHS, bottom of cup).
2. Switch off log scale. Use percentage, not absolute price.
3. Project that same percentage **above** the neckline. That's the target.

### Buy signal

1. Wait for a **green candle whose body breaks above the neckline**. Wick alone doesn't count. Body must cross.
2. Mark the high point of that green candle (Alt J).
3. Buy on the **next day** after the breakout candle.
4. GTT is possible but the strategy requires visual confirmation, so after-market review is the typical approach.

### Conditions

- Pattern should form **below 200 DMA** or at least 15-20% below all-time high. Don't take RHS/CWS patterns forming at all-time highs.
- Reason: the thesis is "buy undervalued, sell at fair value." All-time high is already in the overvalued zone.
- False breakouts happen. Not every neckline break leads to the target. That's why position sizing protects you.

### 10% correction ABCD with RHS/CWS

When the stock doesn't immediately rally after the neckline break:
- If it falls 10% from the buy point, and a new shoulder or handle is forming, take a second trade (1% allocation).
- If it falls further, take a third trade at 10% below the second.
- Maximum 2-3 additional trades.
- Sell each at the previous high (recent resistance) or at the main RHS/CWS target.
- This lets you make money from the oscillation while waiting for the main target to hit.
- Concept: whenever the stock falls 10% from any buy point and then rallies to the recent high, sell. Repeat until the main target is reached.

## 7. 10% correction ABCD (general, any list)

**When to use:** When no specific strategy applies but you see clear value in a deeply discounted stock with strong fundamentals.

**Rules:**
- After taking a position, if the stock falls 10%, take a second trade.
- Sell the second trade when it rallies back to the first buy point (or recent high).
- If it falls another 10% from the second buy, take a third trade.
- Keep repeating: buy at 10% drops, sell at 10% rallies to the previous buy level.
- This works well with stocks trapped in a range. You make 10% on each oscillation while waiting for the eventual breakout.

**ABCD zones for 10% correction:** Same as the standard table (large cap 10/20/30, mid cap 15/30/45, volatile 20/40/60).

---

## Strategy-to-list matrix

| Strategy | F40 | E40 | S200 |
|----------|-----|-----|------|
| Long envelope | Yes | No | No |
| Short envelope | Yes | No | No |
| NOX divergence | Yes | No | No |
| 52-week high/low | Yes | No | No |
| SMA (full ABCD) | Yes | No | No |
| SMA (BCD only) | No | Yes | No |
| RHS / CWS | Yes | Yes | No |
| 10% correction ABCD | Yes | Yes | Yes |
| Support & Resistance | Yes | Yes | Yes |

---

## Core principles across all strategies

- **No stop-loss in any strategy.** The stop-loss is in the stock selection (F40/E40 quality companies) and position sizing (1.5/3/5%).
- **All strategies use daily charts only.** Never weekly, monthly, or intraday.
- **Buy and sell points are ranges, not exact lines.** Plus or minus 0.5-1%.
- **Don't buy at all-time high.** The thesis is buy undervalued, sell at fair/overvalued. All-time high is already in the overvalued zone.
- **Strategy gives the signal. Mindset lets you follow it.** The buy point will come with bad news. The sell point will come with good news. If you follow news instead of strategy, you won't execute.
- **Primary strategy first.** Envelope and NOX are the core. SMA, RHS, CWS, 10% correction are backups for situations where primary strategies don't give a signal.

---

## Practical tips to keep in mind

- **Place sell GTT the day after buy executes.** Forgetting costs months of locked capital and opportunity returns.
- **Weekly review (1-2 hours):** Check open trades in trading journal. Verify all GTTs are placed. Look for new opportunities across F40/E40. That's it.
- Don't watch the market during trading hours. Don't watch the portfolio daily. Use the trading journal as the single source of truth.
- **Back-test at least 2 stocks from F40** using TradingView replay mode before deploying real capital on any strategy.
- When multiple strategies align on the same stock (envelope + NOX + 52-week), that's the highest-conviction entry. These confluences are rare but produce the best results.
- RHS/CWS patterns are checked visually. Spend 5-10 minutes per stock scanning for patterns. With practice, pattern recognition becomes fast.
- Zerodha FIFO P&L will differ from your trading journal P&L on individual trades. Total profit is the same. Trust your journal, not the demat screen.
- **Workflow:** Stock selection (F40/E40) then chart pattern check then fundamental check then risk management (sizing) then execute then weekly review.
- Earn more in your job. Get promoted. Invest more capital. The strategies compound better with larger capital. Two hours per week of trading work is designed to coexist with a full-time career.
