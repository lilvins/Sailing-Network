/* Bounty over one season: one line, the peak marked, the last value labeled,
   crosshair + tooltip on hover. Single series, so no legend: the card title
   says what it is. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { BountyPoint } from "../../lib/api";
import { formatBounty } from "./format";
import "./stats.css";

const PAD = { top: 18, right: 64, bottom: 26, left: 58 };

export function BountyChart({ points, height = 220 }: { points: BountyPoint[]; height?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(260, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (points.length === 0) return null;
    const vals = points.map((p) => p.bounty);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const padV = Math.max((hi - lo) * 0.12, 20e6);
    lo -= padV; hi += padV;
    // clean ticks every 50M / 100M / 200M
    const span = hi - lo;
    const step = span > 1.2e9 ? 400e6 : span > 600e6 ? 200e6 : span > 250e6 ? 100e6 : 50e6;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const w = width - PAD.left - PAD.right;
    const h = height - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * h;
    let peak = 0;
    vals.forEach((v, i) => { if (v > vals[peak]) peak = i; });
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.bounty).toFixed(1)}`).join("");
    const area = `${d}L${x(points.length - 1).toFixed(1)},${PAD.top + h}L${x(0).toFixed(1)},${PAD.top + h}Z`;
    return { ticks, x, y, d, area, peak, t0, t1, h, w };
  }, [points, width, height]);

  if (!geo) return <div className="sx-chart-empty">No ranked games this season yet.</div>;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = points.length === 1 ? 0 : Math.round(((px - PAD.left) / geo.w) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const last = points.length - 1;
  const hp = hover != null ? points[hover] : null;
  const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="sx-chart" ref={wrapRef}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={`Bounty this season, from ${formatBounty(points[0].bounty)} to ${formatBounty(points[last].bounty)}, peak ${formatBounty(points[geo.peak].bounty)}`}>
        {geo.ticks.map((v) => (
          <g key={v}>
            <line className="sx-grid" x1={PAD.left} x2={width - PAD.right} y1={geo.y(v)} y2={geo.y(v)} />
            <text className="sx-axis" x={PAD.left - 8} y={geo.y(v) + 4} textAnchor="end">{formatBounty(v)}</text>
          </g>
        ))}
        <text className="sx-axis" x={PAD.left} y={height - 6}>{fmtDay(geo.t0)}</text>
        <text className="sx-axis" x={width - PAD.right} y={height - 6} textAnchor="end">{fmtDay(geo.t1)}</text>

        <path className="sx-area" d={geo.area} />
        <path className="sx-line" d={geo.d} />

        {/* peak */}
        <circle className="sx-peak" cx={geo.x(geo.peak)} cy={geo.y(points[geo.peak].bounty)} r={4} />
        {geo.peak !== last && (
          <text className="sx-label muted" x={geo.x(geo.peak)} y={geo.y(points[geo.peak].bounty) - 9} textAnchor="middle">peak</text>
        )}
        {/* end value */}
        <circle className="sx-end" cx={geo.x(last)} cy={geo.y(points[last].bounty)} r={4.5} />
        <text className="sx-label" x={geo.x(last) + 9} y={geo.y(points[last].bounty) + 4}>{formatBounty(points[last].bounty)}</text>

        {hp && hover != null && (
          <g pointerEvents="none">
            <line className="sx-cross" x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={PAD.top + geo.h} />
            <circle className="sx-end" cx={geo.x(hover)} cy={geo.y(hp.bounty)} r={5} />
          </g>
        )}
      </svg>
      {hp && hover != null && (
        <div className="sx-tip" style={{ left: Math.min(width - 150, Math.max(0, geo.x(hover) - 70)), top: Math.max(0, geo.y(hp.bounty) - 58) }}>
          <b>{formatBounty(hp.bounty)}</b>
          <span>Game {hover + 1} · {fmtDay(hp.t)}</span>
          {hover > 0 && (
            <span className={hp.bounty >= points[hover - 1].bounty ? "up" : "down"}>
              {hp.bounty >= points[hover - 1].bounty ? "▲" : "▼"} {formatBounty(Math.abs(hp.bounty - points[hover - 1].bounty))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
