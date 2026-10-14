/**
 * Price-history analysis. Everything here is explicit about coverage: we
 * report how many days and how many sources the data spans and never imply
 * a longer history than we actually have.
 */

export interface PricePoint {
  at: Date | string;
  minor: number; // lowest final price observed across trusted sources at that time
  sourceCount?: number;
}

export interface HistoryStats {
  points: number;
  coverageDays: number;
  firstAt: string | null;
  highMinor: number | null;
  lowMinor: number | null;
  currentMinor: number | null;
  medianMinor: number | null;
  /** Position of the current price between low (0) and high (1). */
  position: number | null;
}

const DAY = 86_400_000;

export function historyStats(points: PricePoint[]): HistoryStats {
  if (points.length === 0) {
    return { points: 0, coverageDays: 0, firstAt: null, highMinor: null, lowMinor: null, currentMinor: null, medianMinor: null, position: null };
  }
  const sorted = [...points].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const values = sorted.map((p) => p.minor);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const current = values[values.length - 1] as number;
  const mid = [...values].sort((a, b) => a - b);
  const median = mid.length % 2 ? (mid[(mid.length - 1) / 2] as number) : Math.round(((mid[mid.length / 2 - 1] as number) + (mid[mid.length / 2] as number)) / 2);
  const first = new Date((sorted[0] as PricePoint).at);
  const last = new Date((sorted[sorted.length - 1] as PricePoint).at);
  return {
    points: sorted.length,
    coverageDays: Math.max(1, Math.round((last.getTime() - first.getTime()) / DAY)),
    firstAt: first.toISOString(),
    highMinor: high,
    lowMinor: low,
    currentMinor: current,
    medianMinor: median,
    position: high === low ? 0 : (current - low) / (high - low),
  };
}

export type BuyAdvice = 'buy_now' | 'fair' | 'consider_waiting' | 'insufficient_data';

export interface BuyTiming {
  advice: BuyAdvice;
  /** Rough probability that the price drops meaningfully (≥3%) within ~30 days. Never a guarantee. */
  dropLikelihood: 'low' | 'medium' | 'high' | 'unknown';
  stats: HistoryStats;
}

/** Heuristic estimate — the UI and assistant must present it as an estimate, not a promise. */
export function buyTiming(points: PricePoint[]): BuyTiming {
  const stats = historyStats(points);
  if (stats.points < 5 || stats.coverageDays < 14 || stats.position === null) {
    return { advice: 'insufficient_data', dropLikelihood: 'unknown', stats };
  }
  const nearLow = stats.lowMinor !== null && stats.currentMinor !== null && stats.currentMinor <= stats.lowMinor * 1.03;
  if (nearLow || stats.position <= 0.2) return { advice: 'buy_now', dropLikelihood: 'low', stats };
  if (stats.position <= 0.55) return { advice: 'fair', dropLikelihood: 'medium', stats };
  return { advice: 'consider_waiting', dropLikelihood: 'high', stats };
}
