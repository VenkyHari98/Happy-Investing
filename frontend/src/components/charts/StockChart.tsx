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
  markers?: TradeMarker[];
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
  markers = [],
  height = 360,
  ticker,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
      });
      s.setData(w52Low as LineData[]);
    }

    if (w52High?.length) {
      const s = chart.addSeries(LineSeries, {
        color: "#a78bfa",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "52W High",
      });
      s.setData(w52High as LineData[]);
    }

    if (ma200?.length) {
      const s = chart.addSeries(LineSeries, {
        color: "#34d399",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "200 SMA",
      });
      s.setData(ma200 as LineData[]);
    }

    if (lowerEnvelope?.length) {
      const s = chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "Lower Env",
      });
      s.setData(lowerEnvelope as LineData[]);
    }

    if (upperEnvelope?.length) {
      const s = chart.addSeries(LineSeries, {
        color: "#fb923c",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "Upper Env",
      });
      s.setData(upperEnvelope as LineData[]);
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
  }, [prices, w52Low, w52High, ma200, upperEnvelope, lowerEnvelope, height]);

  // ── Effect 2: update markers only — never recreates the chart ─────────────
  useEffect(() => {
    if (!markersPluginRef.current) return;
    markersPluginRef.current.setMarkers(buildMarkerData(markers));
  }, [markers]);

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
