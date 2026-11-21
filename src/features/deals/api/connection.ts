import type { Connection } from './pipelineClient';

/** Consecutive failed requests before we call the server unreachable and pause. */
const UNREACHABLE_AFTER = 3;
const MAX_PROBE_MS = 30_000;

/**
 * The connection as the sync engine sees it:
 *
 *   online ──browser/simulator offline──► offline ──back online──► online (+ fetch missed changes)
 *   online ──3 failed requests in a row──► unreachable ──check (3s, 6s, 12s… max 30s)──► online
 *
 * While not online nothing is sent; changes wait. A check stays "unreachable"
 * (so the banner doesn't flicker) but lets the queue send: the first success
 * makes us online, the first failure schedules the next check.
 */
export class ConnectionState {
  state: Connection = 'online';
  /** When we lost the connection (for "offline since 10:42"). */
  offlineSince: number | null = null;
  /** When the next automatic reconnect attempt happens (unreachable only). */
  nextProbeAt: number | null = null;
  /** A reconnect check is running: still unreachable, but requests may go out. */
  checking = false;
  private failures = 0;
  private probeDelay: number;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly probeMs: number,
    private readonly on: {
      /** The state changed (what the UI shows depends on it). */
      change(): void;
      /** Sending may start again; `catchUp` = also fetch changes missed while disconnected. */
      resume(catchUp: boolean): void;
    },
  ) {
    this.probeDelay = probeMs;
  }

  get online() {
    return this.state === 'online';
  }

  /** Whether requests may be sent now. */
  get canSend() {
    return this.state === 'online' || this.checking;
  }

  /** From the browser's online/offline events and the simulator's switch. */
  setOnline(online: boolean) {
    if (!online) return this.set('offline');
    if (this.state === 'online') return;
    this.failures = 0;
    this.probeDelay = this.probeMs;
    this.set('online');
    this.offlineSince = null;
    this.on.resume(true);
  }

  /** "Retry now" on the unreachable banner. */
  retryNow() {
    if (this.state === 'unreachable') this.probe();
  }

  /** The server answered (even if it refused some items). */
  succeeded() {
    this.failures = 0;
    if (!this.checking) return;
    this.set('online'); // the check worked: back to normal, and fetch what we missed
    this.on.resume(true);
  }

  /**
   * A request failed at the network level. Returns true when the changes in it
   * should WAIT for the connection (offline or unreachable) instead of failing.
   */
  failed(offline: boolean): boolean {
    if (offline) {
      this.set('offline');
      return true;
    }
    if (this.checking) {
      this.enterUnreachable(); // the check failed: wait longer, banner stays up
      return true;
    }
    if (++this.failures < UNREACHABLE_AFTER) return false;
    if (this.state !== 'unreachable') this.enterUnreachable();
    return true;
  }

  destroy() {
    this.clearProbe();
  }

  private set(c: Connection) {
    if (c === this.state) return;
    if (c !== 'online' && this.state === 'online') this.offlineSince = Date.now();
    this.state = c;
    this.checking = false;
    if (c !== 'unreachable') this.clearProbe();
    this.on.change();
  }

  /** Server looks down: stop sending, test again later with growing gaps. */
  private enterUnreachable() {
    this.set('unreachable');
    this.checking = false;
    this.clearProbe();
    this.nextProbeAt = Date.now() + this.probeDelay;
    this.probeTimer = setTimeout(() => this.probe(), this.probeDelay);
    this.probeDelay = Math.min(this.probeDelay * 2, MAX_PROBE_MS);
    this.on.change();
  }

  private probe() {
    this.clearProbe();
    this.checking = true;
    this.on.change();
    this.on.resume(false);
  }

  private clearProbe() {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
    this.nextProbeAt = null;
  }
}
