import type { Actor, Api } from '@/entities/deal';

/** Simulator-only types: knobs for the fake backend. Not part of the app's API contract. */

/** Everything the reviewer can tune at runtime from the Simulator panel. */
export interface SimConfig {
  latencyMinMs: number;
  latencyMaxMs: number;
  /** Probability that a save request fails at the network level (whole request). */
  failureRate: number;
  /** Of those failures, the share where the server DID apply the write but the response was lost (fixed; not in the Simulator UI). */
  lostResponseShare: number;
  /** Per-deal rejection rate: the server answers but refuses that deal (single saves and inside bulk requests). */
  itemFailureRate: number;
  /** Teammate edits per second across the whole pipeline. */
  teammateEditsPerSec: number;
  /** Max delay before a change is pushed to clients (simulated websocket). */
  pushDelayMaxMs: number;
  online: boolean;
  /** Test hook: a teammate edits the deal right before the next save lands (not in the Simulator UI). */
  conflictNextSave: boolean;
}

export const DEFAULT_CONFIG: SimConfig = {
  latencyMinMs: 300,
  latencyMaxMs: 1500,
  failureRate: 0.1,
  lostResponseShare: 0.3,
  itemFailureRate: 0.02,
  teammateEditsPerSec: 0.2, // one every 5s: noticeable without being noisy
  pushDelayMaxMs: 400,
  online: true,
  conflictNextSave: false,
};

export interface ServerStats {
  requests: number;
  applied: number;
  duplicatesSuppressed: number;
  conflicts: number;
  failedRequests: number;
}

/** Simulator controls (not part of a real API). */
export interface SimControls {
  getConfig(): SimConfig;
  setConfig(patch: Partial<SimConfig>): void;
  onConfig(listener: (c: SimConfig) => void): () => void;
  registerSession(actor: Actor): void;
  unregisterSession(session: string): void;
  /** Throw away every change and start from fresh sample data (all tabs reload). */
  resetDemoData(): void;
  onReset(listener: () => void): () => void;
}

/** The simulator's handle on the fake backend. `shared` = one server for every tab (SharedWorker). */
export type Simulator = SimControls & { shared: boolean };

/** The fake backend: the app's API plus simulator controls. The app gets them as two separate handles. */
export type Backend = Api & Simulator;
