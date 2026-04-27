/**
 * Sparkline — tiny SVG line chart.
 *
 * Uses a deterministic series so the same `seed` always renders the
 * same shape (stable across re-renders). Replace with real metrics
 * series when the monitoring endpoint lands.
 */
import { useMemo } from 'react';

const W = 380;
const H = 56;
const P = 4;

export interface SparklineProps {
  /** Numeric series — pre-computed by the page via deterministicSeries() */
  data: number[];
  /** Stroke + area fill color (oklch CSS color) */
  color?: string;
  /** Min/max overrides for normalization */
  min?: number;
  max?: number;
}

export function Sparkline({ data, color = 'var(--ol-primary)', min, max }: SparklineProps) {
  const { linePath, areaPath } = useMemo(() => {
    if (data.length === 0) return { linePath: '', areaPath: '' };
    const lo = min ?? Math.min(...data);
    const hi = max ?? Math.max(...data);
    const range = hi - lo || 1;
    const stepX = (W - P * 2) / Math.max(1, data.length - 1);
    const points = data.map((v, i) => {
      const x = P + i * stepX;
      const y = H - P - ((v - lo) / range) * (H - P * 2);
      return [x, y] as const;
    });
    const line = points
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ');
    const area = `${line} L ${P + (data.length - 1) * stepX} ${H - P} L ${P} ${H - P} Z`;
    return { linePath: line, areaPath: area };
  }, [data, min, max]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <path d={areaPath} fill={color} fillOpacity={0.18} />
      <path d={linePath} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default Sparkline;
