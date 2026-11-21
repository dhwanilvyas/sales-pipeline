import type { SimConfig } from './types';
import { type Actor, type BulkChange, type BulkUpdate, type Deal } from '@/entities/deal';

/** Api methods called over RPC (same names as the Api interface). */
export type CallMethod = 'listDeals' | 'move' | 'changesSince' | 'startBulkMove' | 'cancelBulk' | 'retryBulkFailed' | 'undoBulk' | 'bulkJobs';

/** Messages from a tab to the shared server worker. */
export type ToServer =
  | { t: 'call'; id: number; method: CallMethod; args: unknown[] }
  | { t: 'setConfig'; patch: Partial<SimConfig> }
  | { t: 'register'; actor: Actor }
  | { t: 'bye'; session: string }
  | { t: 'reset' };

/** Messages from the worker to a tab. */
export type ToClient =
  | { t: 'res'; id: number; ok: true; value: unknown }
  | { t: 'res'; id: number; ok: false; error: { message: string; network: boolean; offline: boolean } }
  | { t: 'push'; deal: Deal }
  | { t: 'bulkChange'; change: BulkChange }
  | { t: 'job'; update: BulkUpdate }
  | { t: 'config'; config: SimConfig }
  /** Demo data was reset: every tab must drop local state and reload. */
  | { t: 'reset' };
