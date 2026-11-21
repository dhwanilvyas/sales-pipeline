export const STAGES = ['new', 'contacted', 'demo', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  new: 'New Lead',
  contacted: 'Contacted',
  demo: 'Demo Done',
  proposal: 'Proposal Sent',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

export const OPEN_STAGES: readonly Stage[] = STAGES.slice(0, 5);
export const isOpen = (s: Stage) => s !== 'won' && s !== 'lost';

export const OWNERS = [
  'Priya', 'Rahul', 'Ananya', 'Arjun', 'Sneha', 'Vikram', 'Kavya', 'Rohan', 'Isha', 'Aditya',
  'Meera', 'Karan', 'Divya', 'Nikhil', 'Pooja', 'Siddharth', 'Neha', 'Varun', 'Tanvi', 'Aman',
] as const;

/** Pipelines (one for now). A deal belongs to one; more pipelines would each have their own stages. */
export const PIPELINES = [{ id: 'sales', name: 'Sales pipeline' }] as const;

/**
 * Two-letter initials, unique within the team (first names only, so "Kavya" is
 * KA and "Karan" becomes KR rather than a second KA).
 */
const OWNER_INITIALS = (() => {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const name of OWNERS) {
    const up = name.toUpperCase();
    let pick = up.slice(0, 2);
    for (let i = 1; taken.has(pick) && i < up.length; i++) pick = up[0] + up[i];
    taken.add(pick);
    out.set(name, pick);
  }
  return out;
})();

export function ownerInitials(name: string): string {
  return OWNER_INITIALS.get(name) ?? name.slice(0, 2).toUpperCase();
}

/**
 * A deal as the server knows it. Objects are treated as immutable: every write
 * produces a new object with a higher `version`, which lets React memoise rows
 * by reference and lets the client discard stale pushes by version.
 */
export interface Deal {
  id: string;
  name: string;
  licences: number;
  value: number; // INR
  owner: string;
  stage: Stage;
  /** Scheduled follow-up. null = nothing scheduled. */
  nextStepAt: number | null;
  expectedCloseAt: number;
  lastActivityAt: number;
  stageChangedAt: number;
  /** Who made the last STAGE change (updatedBy can be someone who later edited another field). */
  stageChangedBy: string;
  updatedAt: number;
  updatedBy: string;
  /** Which client session (browser tab) made the change; 'sim' for simulated teammates. */
  updatedBySession: string;
  version: number;
  /** Server-wide change sequence of this deal's last write (0 = never changed). Used to catch up after reconnecting. */
  seq: number;
}

// Calendar helpers live in shared/utils (generic); re-exported here for convenience.
export { DAY, startOfDay, dayDiff } from '@/shared/utils/dates';
