# Envelope Strategy Grid Search Results

**Run date:** 2026-06-10  
**Simulation window:** 2021-06-10 → 2026-06-10 (5 years)  
**Total combinations tested:** 5184  
**Elapsed:** 5.4 minutes  

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
| 1 | 13.05% | 15% | 2.5% | 5.0% | 2.0% | 1.5% | rolling | Yes | 56 | 94.6% | 13.2% |
| 2 | 13.05% | 15% | 2.5% | 5.0% | 2.0% | 2.0% | rolling | Yes | 56 | 94.6% | 13.2% |
| 3 | 13.05% | 15% | 2.5% | 5.0% | 2.0% | 2.5% | rolling | Yes | 56 | 94.6% | 13.2% |
| 4 | 12.61% | 15% | 2.5% | 5.0% | 2.5% | 1.5% | rolling | Yes | 55 | 94.5% | 13.0% |
| 5 | 12.61% | 15% | 2.5% | 5.0% | 2.5% | 2.0% | rolling | Yes | 55 | 94.5% | 13.0% |
| 6 | 12.61% | 15% | 2.5% | 5.0% | 2.5% | 2.5% | rolling | Yes | 55 | 94.5% | 13.0% |
| 7 | 12.60% | 14% | 2.5% | 5.0% | 2.0% | 1.5% | rolling | Yes | 62 | 93.5% | 13.0% |
| 8 | 12.60% | 14% | 2.5% | 5.0% | 2.0% | 2.0% | rolling | Yes | 62 | 93.5% | 13.0% |
| 9 | 12.60% | 14% | 2.5% | 5.0% | 2.0% | 2.5% | rolling | Yes | 62 | 93.5% | 13.0% |
| 10 | 12.58% | 13% | 2.5% | 5.0% | 2.0% | 1.5% | rolling | Yes | 67 | 91.0% | 13.3% |
| 11 | 12.58% | 13% | 2.5% | 5.0% | 2.0% | 2.0% | rolling | Yes | 67 | 91.0% | 13.3% |
| 12 | 12.58% | 13% | 2.5% | 5.0% | 2.0% | 2.5% | rolling | Yes | 67 | 91.0% | 13.3% |
| 13 | 12.58% | 15% | 2.5% | 5.0% | 3.0% | 1.5% | rolling | Yes | 54 | 98.2% | 13.1% |
| 14 | 12.58% | 15% | 2.5% | 5.0% | 3.0% | 2.0% | rolling | Yes | 54 | 98.2% | 13.1% |
| 15 | 12.58% | 15% | 2.5% | 5.0% | 3.0% | 2.5% | rolling | Yes | 54 | 98.2% | 13.1% |
| 16 | 12.45% | 14% | 2.5% | 5.0% | 2.5% | 1.5% | rolling | Yes | 62 | 93.5% | 13.6% |
| 17 | 12.45% | 14% | 2.5% | 5.0% | 2.5% | 2.0% | rolling | Yes | 62 | 93.5% | 13.6% |
| 18 | 12.45% | 14% | 2.5% | 5.0% | 2.5% | 2.5% | rolling | Yes | 62 | 93.5% | 13.6% |
| 19 | 12.43% | 12% | 2.5% | 5.0% | 2.0% | 1.5% | rolling | Yes | 73 | 93.2% | 14.1% |
| 20 | 12.43% | 12% | 2.5% | 5.0% | 2.0% | 2.0% | rolling | Yes | 73 | 93.2% | 14.1% |

## Best by Category

### Best — Fixed Exit
| CAGR | Env% | Zone% | Large% | Mid% | Small% | Pyramid | Trades | WinR% | MaxDD% |
|------|------|-------|--------|------|--------|---------|--------|-------|--------|
| 10.80% | 12% | 2.5% | 5.0% | 2.0% | 1.5% | No | 62 | 100.0% | 15.3% |

### Best — Rolling Exit
| CAGR | Env% | Zone% | Large% | Mid% | Small% | Pyramid | Trades | WinR% | MaxDD% |
|------|------|-------|--------|------|--------|---------|--------|-------|--------|
| 13.05% | 15% | 2.5% | 5.0% | 2.0% | 1.5% | Yes | 56 | 94.6% | 13.2% |

### Best — With Pyramid
| CAGR | Env% | Zone% | Large% | Mid% | Small% | Exit | Trades | WinR% | MaxDD% |
|------|------|-------|--------|------|--------|------|--------|-------|--------|
| 13.05% | 15% | 2.5% | 5.0% | 2.0% | 1.5% | rolling | 56 | 94.6% | 13.2% |

### Best — Without Pyramid
| CAGR | Env% | Zone% | Large% | Mid% | Small% | Exit | Trades | WinR% | MaxDD% |
|------|------|-------|--------|------|--------|------|--------|-------|--------|
| 12.16% | 15% | 2.5% | 5.0% | 3.0% | 1.5% | rolling | 60 | 93.3% | 10.6% |

## Top 20 Pattern Analysis

| Parameter | Value | Count in Top 20 |
|-----------|-------|-----------------|
| Envelope % | 15% | 9/20 |
| Envelope % | 14% | 6/20 |
| Envelope % | 13% | 3/20 |
| Envelope % | 12% | 2/20 |
| Zone % | 2.5% | 20/20 |
| Exit mode | rolling | 20/20 |
| Pyramid | Yes | 20/20 |
| Large alloc | 5.0% | 20/20 |
| Mid alloc | 2.0% | 11/20 |
| Mid alloc | 2.5% | 6/20 |
| Mid alloc | 3.0% | 3/20 |
| Small alloc | 1.5% | 7/20 |
| Small alloc | 2.0% | 7/20 |
| Small alloc | 2.5% | 6/20 |

## Recommended Configuration

Based on maximum CAGR over the 5-year simulation window:

| Parameter | Value |
|-----------|-------|
| Envelope % | **15%** |
| Zone % | **2.5%** |
| Large Cap allocation | **5.0%** |
| Mid Cap allocation | **2.0%** |
| Small Cap allocation | **1.5%** |
| Exit mode | **rolling** |
| Pyramid | **Yes** |

**CAGR: 13.05%**  |  Total return: 84.6%  |  Trades: 56  |  Win rate: 94.6%  |  Max drawdown: 13.2%  |  Time in market: 91.0%

---
*Full results: `Source Data/Downloaded Data/envelope_grid_results.csv`*
