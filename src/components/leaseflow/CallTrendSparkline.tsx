import { useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Tiny dependency-free SVG sparkline. Renders an area + line with one dot
 * per data point. Designed to sit inline next to a label.
 */
export default function CallTrendSparkline({
  values,
  labels,
  width = 140,
  height = 36,
  className,
  strokeClassName = "stroke-primary",
  fillClassName = "fill-primary/15",
  dotClassName = "fill-primary",
}: {
  values: number[];
  labels?: string[];
  width?: number;
  height?: number;
  className?: string;
  strokeClassName?: string;
  fillClassName?: string;
  dotClassName?: string;
}) {
  const { path, area, points, max } = useMemo(() => {
    if (values.length === 0) {
      return { path: "", area: "", points: [] as { x: number; y: number; v: number }[], max: 0 };
    }
    const pad = 2;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const max = Math.max(1, ...values); // never zero — keeps shape
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    const pts = values.map((v, i) => ({
      x: pad + (values.length === 1 ? w / 2 : i * step),
      y: pad + h - (v / max) * h,
      v,
    }));
    const path = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");
    const area = `${path} L${pts[pts.length - 1].x.toFixed(2)},${pad + h} L${pts[0].x.toFixed(2)},${pad + h} Z`;
    return { path, area, points: pts, max };
  }, [values, width, height]);

  if (values.length === 0) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={`Trend: ${values.join(", ")}. Max ${max}.`}
    >
      <path d={area} className={fillClassName} />
      <path d={path} fill="none" strokeWidth={1.5} className={strokeClassName} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.6} className={dotClassName}>
          <title>{`${labels?.[i] ?? `Day ${i + 1}`}: ${p.v}`}</title>
        </circle>
      ))}
    </svg>
  );
}