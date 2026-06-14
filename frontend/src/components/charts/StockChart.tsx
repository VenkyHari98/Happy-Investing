"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type LineData,
} from "lightweight-charts";

export interface PatternOverlay {
  patternType: "RHS" | "CWH";
  /** Price points within the pattern date range (date + close) */
  pricePoints: { date: string; price: number }[];
  necklinePrice: number;
  necklineStartDate: string;
  necklineEndDate: string;
  targetPrice: number;
  targetStartDate: string;
  targetEndDate: string;
  /** 0–1 fill opacity; defaults to 0.22 */
  opacity?: number;
}

export interface ChartPoint {
  time: string; // YYYY-MM-DD
  value: number;
}

export interface TradeMarker {
  time: string;
  type: "entry" | "exit" | "rally" | "rallyStart" | "skipped";
  price: number;
  label?: string;
}

interface StockChartProps {
  prices: ChartPoint[];
  w52Low?: ChartPoint[];
  w52High?: ChartPoint[];
  ma200?: ChartPoint[];
  upperEnvelope?: ChartPoint[];
  lowerEnvelope?: ChartPoint[];
  pePoints?: ChartPoint[];   // PE ratio series — rendered on left axis
  peMedian?: number | null;  // 5yr rolling median — shown as dashed price line
  markers?: TradeMarker[];
  patternOverlays?: PatternOverlay[];
  height?: number;
  ticker?: string;
}

function buildMarkerData(markers: TradeMarker[]) {
  return [...markers]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((m) => {
      if (m.type === "rallyStart") {
        return {
          time: m.time as import("lightweight-charts").Time,
          position: "belowBar" as const,
          color: "#f59e0b",
          shape: "arrowUp" as const,
          text: m.label ?? "RS",
        };
      }
      if (m.type === "rally") {
        return {
          time: m.time as import("lightweight-charts").Time,
          position: "aboveBar" as const,
          color: "#c084fc",
          shape: "arrowDown" as const,
          text: m.label ?? "R",
        };
      }
      if (m.type === "skipped") {
        return {
          time: m.time as import("lightweight-charts").Time,
          position: "belowBar" as const,
          color: "#6b7280",
          shape: "circle" as const,
          text: m.label ?? "M",
        };
      }
      return {
        time: m.time as import("lightweight-charts").Time,
        position: m.type === "entry" ? ("belowBar" as const) : ("aboveBar" as const),
        color: m.type === "entry" ? "#22c55e" : "#f87171",
        shape: m.type === "entry" ? ("arrowUp" as const) : ("arrowDown" as const),
        text: m.label ?? (m.type === "entry" ? "B" : "S"),
      };
    });
}

export function StockChart({
  prices,
  w52Low,
  w52High,
  ma200,
  upperEnvelope,
  lowerEnvelope,
  pePoints,
  peMedian,
  markers = [],
  patternOverlays,
  height = 360,
  ticker,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  // Keep the markers plugin alive — required in lightweight-charts v5
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // ── Effect 1: chart + series setup ────────────────────────────────────────
  // Markers are intentionally NOT in the dependency array here.
  // Adding them would destroy/recreate the whole chart on every data refresh,
  // losing the user's zoom/pan state. Markers are updated in Effect 2 instead.
  useEffect(() => {
    if (!containerRef.current || prices.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true },
      width: containerRef.current.clientWidth,
      height,
    });
    chartRef.current = chart;

    const priceSeries = chart.addSeries(LineSeries, {
      color: "#60a5fa",
      lineWidth: 2,
      title: "Price",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    priceSeries.setData(prices as LineData[]);
    priceSeriesRef.current = priceSeries;

    // Initialise the markers plugin with an empty array so it's ready for Effect 2
    markersPluginRef.current = createSeriesMarkers(priceSeries, []);

    if (w52Low?.length) {
      const s = chart.addSeries(LineSeries, {
        color: "#f97316",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "52W Low",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(w52Low as LineData[]);
    }

    if (w52High?.length) {
      const s = chart.addSeries(LineSeries, {
        color: "#a78bfa",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "52W High",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(w52High as LineData[]);
    }

    if (ma200?.length) {
      const s = chart.addSeries(LineSeries, {
        color: "#34d399",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "200 SMA",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(ma200 as LineData[]);
    }

    if (lowerEnvelope?.length) {
      const s = chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "Lower Env",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(lowerEnvelope as LineData[]);
    }

    if (upperEnvelope?.length) {
      const s = chart.addSeries(LineSeries, {
        color: "#fb923c",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "Upper Env",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(upperEnvelope as LineData[]);
    }

    if (pePoints?.length) {
      chart.applyOptions({
        leftPriceScale: { visible: true, borderColor: "#374151", textColor: "rgba(255, 255, 255, 0.5)" },
      });
      const peSeries = chart.addSeries(LineSeries, {
        priceScaleId: "left",
        color: "rgba(255, 255, 255, 0.5)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "PE",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      peSeries.setData(pePoints as LineData[]);

      if (peMedian != null) {
        peSeries.createPriceLine({
          price: peMedian,
          color: "rgba(255, 255, 255, 0.5)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: "5Y Median",
          axisLabelVisible: true,
        });
      }
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      markersPluginRef.current = null;
      priceSeriesRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, w52Low, w52High, ma200, upperEnvelope, lowerEnvelope, pePoints, peMedian, height]);

  // ── Effect 2: update markers only — never recreates the chart ─────────────
  useEffect(() => {
    if (!markersPluginRef.current) return;
    markersPluginRef.current.setMarkers(buildMarkerData(markers));
  }, [markers]);

  // ── Effect 3: canvas pattern shape overlays ────────────────────────────────
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const chart = chartRef.current;
    const series = priceSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const container = containerRef.current;
    if (!container) return;

    function redraw() {
      if (!canvas || !chart || !series) return;

      const dpr = window.devicePixelRatio || 1;
      const w = container!.clientWidth;
      const h = height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      if (!patternOverlays?.length) return;

      for (const overlay of patternOverlays) {
        const opacity = overlay.opacity ?? 0.22;
        const fillColor =
          overlay.patternType === "RHS"
            ? `rgba(249,115,22,${opacity})`
            : `rgba(59,130,246,${opacity})`;

        const neckYCoord = series.priceToCoordinate(overlay.necklinePrice);
        if (neckYCoord === null) continue;
        const neckY = neckYCoord as number;

        // Collect valid price path points within pattern range
        const rawPts = overlay.pricePoints.map((p) => ({
          x: chart.timeScale().timeToCoordinate(p.date as Time),
          y: series.priceToCoordinate(p.price),
        }));
        const pts = rawPts
          .filter((p) => p.x !== null && p.y !== null)
          .map((p) => ({ x: p.x as number, y: p.y as number }));

        if (pts.length < 2) continue;

        const x0 = pts[0].x;
        const xN = pts[pts.length - 1].x;

        // ── Filled polygon: neckline (top) → price series (bottom) ──
        ctx.beginPath();
        ctx.moveTo(x0, neckY);
        ctx.lineTo(xN, neckY);
        for (let i = pts.length - 1; i >= 0; i--) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        // ── Neckline dashed line ──────────────────────────────────────
        const neckXStartCoord = chart.timeScale().timeToCoordinate(overlay.necklineStartDate as Time);
        const neckXEndCoord = chart.timeScale().timeToCoordinate(overlay.necklineEndDate as Time);
        if (neckXStartCoord !== null && neckXEndCoord !== null) {
          ctx.beginPath();
          ctx.setLineDash([6, 4]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = `rgba(245,158,11,${Math.min(opacity * 3.5, 0.9)})`;
          ctx.moveTo(neckXStartCoord as number, neckY);
          ctx.lineTo(neckXEndCoord as number, neckY);
          ctx.stroke();
        }

        // ── Target dashed line ─────────────────────────────────────────
        const targetYCoord = series.priceToCoordinate(overlay.targetPrice);
        const tgtXStartCoord = chart.timeScale().timeToCoordinate(overlay.targetStartDate as Time);
        const tgtXEndCoord = chart.timeScale().timeToCoordinate(overlay.targetEndDate as Time);
        if (targetYCoord !== null && tgtXStartCoord !== null && tgtXEndCoord !== null) {
          ctx.beginPath();
          ctx.setLineDash([8, 5]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = `rgba(34,197,94,${Math.min(opacity * 3.5, 0.85)})`;
          ctx.moveTo(tgtXStartCoord as number, targetYCoord as number);
          ctx.lineTo(tgtXEndCoord as number, targetYCoord as number);
          ctx.stroke();
        }

        ctx.setLineDash([]);
      }
    }

    redraw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternOverlays, height]);

  if (prices.length === 0) {
    return (
      <div className="relative w-full">
        <div
          className="flex items-center justify-center text-muted-foreground text-sm"
          style={{ height }}
        >
          No price data
        </div>
      </div>
    );
  }

  const tvSymbol = ticker ? `NSE:${ticker.replace(/\.(NS|BO)$/i, "")}` : null;

  return (
    <div className="relative w-full">
      <div ref={containerRef} style={{ height }} className="w-full" />
      {/* Canvas overlay for pattern shape fills — sits above chart, no pointer events */}
      <canvas
        ref={overlayCanvasRef}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      />
      {tvSymbol && (
        // Transparent overlay covering the TradingView watermark (bottom-left of the canvas).
        // Makes the native watermark act as a link to the stock page without visual changes.
        <a
          href={`https://www.tradingview.com/chart/?symbol=${tvSymbol}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${ticker} on TradingView`}
          aria-label={`Open ${ticker} on TradingView`}
          style={{ position: "absolute", bottom: 4, left: 8, width: 44, height: 28, zIndex: 10 }}
        />
      )}
    </div>
  );
}
