
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
import { dayDiff } from './dates';
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
const num = new Intl.NumberFormat('en-IN');
const date = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

export const fmtINR = (v: number) => inr.format(v);
export const fmtINRCompact = (v: number) => inrCompact.format(v);
export const fmtNum = (v: number) => num.format(v);
export const fmtDate = (t: number) => date.format(t);

/** "today", "in 3d", "2d ago" */
export function fmtRelDay(t: number, now: number): string {
  const d = dayDiff(t, now);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d}d` : `${-d}d ago`;
}

/** "just now", "4m ago", "3h ago", "12 Nov" */
export function fmtAgo(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return fmtDate(t);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
