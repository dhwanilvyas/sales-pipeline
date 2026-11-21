import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState } from './connection';

describe('ConnectionState', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const resume = vi.fn();
    const c = new ConnectionState(1000, { change: () => {}, resume });
    return { c, resume };
  };

  it('offline holds changes; coming back resumes and catches up', () => {
    const { c, resume } = make();
    expect(c.failed(true)).toBe(true);
    expect(c.state).toBe('offline');
    expect(c.offlineSince).not.toBeNull();
    c.setOnline(true);
    expect(c.state).toBe('online');
    expect(c.offlineSince).toBeNull();
    expect(resume).toHaveBeenCalledWith(true);
  });

  it('three failures in a row → unreachable, then checks with growing gaps (state never flickers)', () => {
    const { c, resume } = make();
    expect(c.failed(false)).toBe(false);
    expect(c.failed(false)).toBe(false);
    expect(c.failed(false)).toBe(true);
    expect(c.state).toBe('unreachable');
    expect(c.canSend).toBe(false);
    vi.advanceTimersByTime(1000);
    // the check sends again but stays "unreachable", so the banner stays up
    expect(c.state).toBe('unreachable');
    expect(c.checking).toBe(true);
    expect(c.canSend).toBe(true);
    expect(resume).toHaveBeenCalledWith(false);
    // the check fails: still unreachable, and the next wait is longer
    expect(c.failed(false)).toBe(true);
    expect(c.checking).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(c.checking).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(c.checking).toBe(true);
  });

  it('a successful check brings us back online and catches up', () => {
    const { c, resume } = make();
    c.failed(false); c.failed(false); c.failed(false);
    vi.advanceTimersByTime(1000);
    c.succeeded();
    expect(c.state).toBe('online');
    expect(c.checking).toBe(false);
    expect(resume).toHaveBeenLastCalledWith(true);
  });

  it('a success resets the failure count', () => {
    const { c } = make();
    c.failed(false);
    c.failed(false);
    c.succeeded();
    expect(c.failed(false)).toBe(false);
    expect(c.state).toBe('online');
  });
});
