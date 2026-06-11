# Envelope Strategy Grid Search Results

**Run date:** 2026-06-10  
**Simulation window:** 2016-06-10 → 2026-06-10 (10 years)  
**Total combinations tested:** 5184  
**Elapsed:** 9.0 minutes  

## Parameter Ranges Tested

| Parameter | Range |
|-----------|-------|
| Envelope % | 12–17% (1% steps) |
| Zone % | 0–2.5% (0.5% steps) |
| Large Cap alloc | 3–5% |
| Mid Cap alloc | 2–3.5% |
| Small Cap alloc | 1.5–2.5% |
| Exit mode | fixed, rolling |
| Pyramid | Yes, No |

## Top 20 Combinations (by CAGR)

| Rank | CAGR | Env% | Zone% | Large% | Mid% | Small% | Exit | Pyramid | Trades | WinR% | MaxDD% |
|------|------|------|-------|--------|------|--------|------|---------|--------|-------|--------|
| 1 | 14.46% | 12% | 2.5% | 5.0% | 3.5% | 1.5% | fixed | Yes | 100 | 100.0% | 31.4% |
| 2 | 14.46% | 12% | 2.5% | 5.0% | 3.5% | 2.0% | fixed | Yes | 100 | 100.0% | 31.4% |
| 3 | 14.46% | 12% | 2.5% | 5.0% | 3.5% | 2.5% | fixed | Yes | 100 | 100.0% | 31.4% |
| 4 | 14.42% | 12% | 2.5% | 5.0% | 2.0% | 1.5% | fixed | Yes | 108 | 100.0% | 30.9% |
| 5 | 14.42% | 12% | 2.5% | 5.0% | 2.0% | 2.0% | fixed | Yes | 108 | 100.0% | 30.9% |
| 6 | 14.42% | 12% | 2.5% | 5.0% | 2.0% | 2.5% | fixed | Yes | 108 | 100.0% | 30.9% |
| 7 | 14.18% | 12% | 2.5% | 5.0% | 2.5% | 1.5% | fixed | Yes | 104 | 100.0% | 31.5% |
| 8 | 14.18% | 12% | 2.5% | 5.0% | 2.5% | 2.0% | fixed | Yes | 104 | 100.0% | 31.5% |
| 9 | 14.18% | 12% | 2.5% | 5.0% | 2.5% | 2.5% | fixed | Yes | 104 | 100.0% | 31.5% |
| 10 | 13.91% | 12% | 2.5% | 5.0% | 3.0% | 1.5% | fixed | Yes | 102 | 100.0% | 31.5% |
| 11 | 13.91% | 12% | 2.5% | 5.0% | 3.0% | 2.0% | fixed | Yes | 102 | 100.0% | 31.5% |
| 12 | 13.91% | 12% | 2.5% | 5.0% | 3.0% | 2.5% | fixed | Yes | 102 | 100.0% | 31.5% |
| 13 | 13.65% | 14% | 2.5% | 5.0% | 3.5% | 1.5% | fixed | Yes | 83 | 100.0% | 32.4% |
| 14 | 13.65% | 14% | 2.5% | 5.0% | 3.5% | 2.0% | fixed | Yes | 83 | 100.0% | 32.4% |
| 15 | 13.65% | 14% | 2.5% | 5.0% | 3.5% | 2.5% | fixed | Yes | 83 | 100.0% | 32.4% |
| 16 | 13.60% | 12% | 2.0% | 5.0% | 2.0% | 1.5% | fixed | Yes | 105 | 100.0% | 30.1% |
| 17 | 13.60% | 12% | 2.0% | 5.0% | 2.0% | 2.0% | fixed | Yes | 105 | 100.0% | 30.1% |
| 18 | 13.60% | 12% | 2.0% | 5.0% | 2.0% | 2.5% | fixed | Yes | 105 | 100.0% | 30.1% |
| 19 | 13.59% | 15% | 2.5% | 5.0% | 3.5% | 1.5% | fixed | Yes | 79 | 100.0% | 28.5% |
| 20 | 13.59% | 15% | 2.5% | 5.0% | 3.5% | 2.0% | fixed | Yes | 79 | 100.0% | 28.5% |

## Best by Category

### Best — Fixed Exit
| CAGR | Env% | Zone% | Large% | Mid% | Small% | Pyramid | Trades | WinR% | MaxDD% |
|------|------|-------|--------|------|--------|---------|--------|-------|--------|
| 14.46% | 12% | 2.5% | 5.0% | 3.5% | 1.5% | Yes | 100 | 100.0% | 31.4% |

### Best — Rolling Exit
| CAGR | Env% | Zone% | Large% | Mid% | Small% | Pyramid | Trades | WinR% | MaxDD% |
|------|------|-------|--------|------|--------|---------|--------|-------|--------|
| 12.89% | 12% | 2.5% | 5.0% | 3.0% | 1.5% | Yes | 136 | 91.9% | 31.0% |

### Best — With Pyramid
| CAGR | Env% | Zone% | Large% | Mid% | Small% | Exit | Trades | WinR% | MaxDD% |
|------|------|-------|--------|------|--------|------|--------|-------|--------|
| 14.46% | 12% | 2.5% | 5.0% | 3.5% | 1.5% | fixed | 100 | 100.0% | 31.4% |

### Best — Without Pyramid
| CAGR | Env% | Zone% | Large% | Mid% | Small% | Exit | Trades | WinR% | MaxDD% |
|------|------|-------|--------|------|--------|------|--------|-------|--------|
| 12.05% | 12% | 2.5% | 5.0% | 3.0% | 1.5% | fixed | 117 | 100.0% | 28.8% |

## Top 20 Pattern Analysis

| Parameter | Value | Count in Top 20 |
|-----------|-------|-----------------|
| Envelope % | 12% | 15/20 |
| Envelope % | 14% | 3/20 |
| Envelope % | 15% | 2/20 |
| Zone % | 2.5% | 17/20 |
| Zone % | 2.0% | 3/20 |
| Exit mode | fixed | 20/20 |
| Pyramid | Yes | 20/20 |
| Large alloc | 5.0% | 20/20 |
| Mid alloc | 3.5% | 8/20 |
| Mid alloc | 2.0% | 6/20 |
| Mid alloc | 2.5% | 3/20 |
| Mid alloc | 3.0% | 3/20 |
| Small alloc | 1.5% | 7/20 |
| Small alloc | 2.0% | 7/20 |
| Small alloc | 2.5% | 6/20 |

## Recommended Configuration

Based on maximum CAGR over the 10-year simulation window:

| Parameter | Value |
|-----------|-------|
| Envelope % | **12%** |
| Zone % | **2.5%** |
| Large Cap allocation | **5.0%** |
| Mid Cap allocation | **3.5%** |
| Small Cap allocation | **1.5%** |
| Exit mode | **fixed** |
| Pyramid | **Yes** |

**CAGR: 14.46%**  |  Total return: 285.9%  |  Trades: 100  |  Win rate: 100.0%  |  Max drawdown: 31.4%  |  Time in market: 91.5%

---
*Full results: `Source Data/Downloaded Data/envelope_grid_results_10y.csv`*
