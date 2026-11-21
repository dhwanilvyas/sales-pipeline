import { dayDiff, isOpen, type Deal } from './deal.types';

export type Reason =
  | { kind: 'overdue'; days: number }
  | { kind: 'due-today' }
  | { kind: 'closing'; days: number }
  | { kind: 'past-close'; days: number }
  | { kind: 'idle'; days: number };

/**
 * Priority tiers, most urgent first. A deal's tier is its most urgent reason:
 *   1 follow-up overdue      a promise already broken
 *   2 follow-up due today    today's promises
 *   3 closing within 7 days  money about to land or slip
 *   4 close date passed      the forecast is wrong
 *   5 going cold             no activity for 14+ days
 *   6 nothing urgent
 * Closed deals (Won/Lost) have no tier. Within a tier, bigger deals come first.
 * Tiers 1–3 are the "Today" queue.
 */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

const TIER: Record<Reason['kind'], Tier> = { overdue: 1, 'due-today': 2, closing: 3, 'past-close': 4, idle: 5 };
const TODAY_MAX_TIER = 3;
const IDLE_DAYS = 14;

export interface Priority {
  /** null for closed deals. */
  tier: Tier | null;
  /** Every reason that applies, most urgent first (the first one sets the tier). */
  reasons: Reason[];
  /** True when the deal belongs in the "Today" queue. */
  actionable: boolean;
}

/** Why should a salesperson look at this deal today, and how urgently? */
export function prioritize(deal: Deal, now: number): Priority {
  if (!isOpen(deal.stage)) return { tier: null, reasons: [], actionable: false };
  const reasons: Reason[] = [];

  if (deal.nextStepAt != null) {
    const d = dayDiff(deal.nextStepAt, now);
    if (d < 0) reasons.push({ kind: 'overdue', days: -d });
    else if (d === 0) reasons.push({ kind: 'due-today' });
  }
  const c = dayDiff(deal.expectedCloseAt, now);
  if (c >= 0 && c <= 7) reasons.push({ kind: 'closing', days: c });
  else if (c < 0) reasons.push({ kind: 'past-close', days: -c });
  const idle = -dayDiff(deal.lastActivityAt, now);
  if (idle >= IDLE_DAYS) reasons.push({ kind: 'idle', days: idle });

  const tier: Tier = reasons.length ? TIER[reasons[0].kind] : 6;
  return { tier, reasons, actionable: tier <= TODAY_MAX_TIER };
}

/** Short form for tight spaces (board cards); the full label goes in a tooltip. */
export function reasonShortLabel(r: Reason): string {
  switch (r.kind) {
    case 'overdue': return `Overdue ${r.days}d`;
    case 'due-today': return 'Due today';
    case 'closing': return r.days === 0 ? 'Closes today' : `Closes ${r.days}d`;
    case 'past-close': return `Past close ${r.days}d`;
    case 'idle': return `Idle ${r.days}d`;
  }
}

export function reasonLabel(r: Reason): string {
  switch (r.kind) {
    case 'overdue': return `Follow-up ${r.days}d overdue`;
    case 'due-today': return 'Follow-up today';
    case 'closing': return r.days === 0 ? 'Closes today' : `Closes in ${r.days}d`;
    case 'past-close': return `Close date passed ${r.days}d ago`;
    case 'idle': return `No activity ${r.days}d`;
  }
}
