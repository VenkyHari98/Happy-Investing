"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  LineSeries,
  type IChartApi,
  type LineData,
} from "lightweight-charts";
import type { EquityCurvePoint } from "@/lib/types";
import { Tip } from "@/components/ui/tooltip";

interface Props {
  data: EquityCurvePoint[];
  initialCapital?: number;
  height?: number;
}

export function EquityCurve({ data, initialCapital = 100000, height = 300 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

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
      timeScale: { borderColor: "#374151", timeVisible: false },
      width: containerRef.current.clientWidth,
      height,
    });
    chartRef.current = chart;

    // Total portfolio value
    const totalSeries = chart.addSeries(LineSeries, {
      color: "#60a5fa",
      lineWidth: 2,
      title: "Portfolio",
    });
    totalSeries.setData(
      data.map((p) => ({ time: p.date, value: p.total_value })) as LineData[]
    );

    // Deployed capital
    const deployedSeries = chart.addSeries(LineSeries, {
      color: "#2dd4bf",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "Deployed",
    });
    deployedSeries.setData(
      data.map((p) => ({ time: p.date, value: p.deployed })) as LineData[]
    );

    // Cash
    const cashSeries = chart.addSeries(LineSeries, {
      color: "#64748b",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      title: "Cash",
    });
    cashSeries.setData(
      data.map((p) => ({ time: p.date, value: p.cash })) as LineData[]
    );

    // Initial capital reference
    const refSeries = chart.addSeries(LineSeries, {
      color: "#374151",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "Initial",
    });
    refSeries.setData(
      data.map((p) => ({ time: p.date, value: initialCapital })) as LineData[]
    );

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, initialCapital, height]);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
      >
        No equity curve data
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-4 text-xs text-muted-foreground px-1">
        <Tip content="Total portfolio value over time (deployed capital + cash)">
          <span className="flex items-center gap-1 cursor-default">
            <span className="inline-block w-3 h-0.5 bg-blue-400" /> Portfolio
          </span>
        </Tip>
        <Tip content="Capital actually invested in open trades at each point in time">
          <span className="flex items-center gap-1 cursor-default">
            <span className="inline-block w-3 h-0.5 bg-teal-400" style={{ borderTop: "1px dashed" }} /> Deployed
          </span>
        </Tip>
        <Tip content="Uninvested capital sitting idle — the gap between portfolio value and deployed capital">
          <span className="flex items-center gap-1 cursor-default">
            <span className="inline-block w-3 h-0.5 bg-slate-500" /> Cash
          </span>
        </Tip>
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}
