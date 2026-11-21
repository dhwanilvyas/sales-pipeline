import { useState } from 'react';
import { toast } from 'sonner';
import { fmtNum, plural } from '@/shared/utils/format';
import { useStableCallbacks } from '@/shared/hooks/useStableCallbacks';
import { MAX_MOVE_ITEMS, STAGES, STAGE_LABEL, type Query, type Stage } from '@/entities/deal';
import type { MoveEntry, PipelineClient } from '@/features/deals/api/pipelineClient';
import type { SelectionState } from './useSelection';

/** Bulk moves of at least this many deals get a (keyboard-friendly) confirm. Smaller ones rely on Undo. */
const CONFIRM_AT = 100;

/**
 * What the user can DO to deals, written once and used by the mouse, the bulk
 * bar and the keyboard alike. Each command acts on the selection when there is
 * one (and the deal is part of it), otherwise on the highlighted deal.
 */
export function useDealCommands(client: PipelineClient, sel: SelectionState, currentId: string | null, show: (id: string) => void) {
  const [confirm, setConfirm] = useState<{ target: Stage; entries: MoveEntry[]; filter: Query | null } | null>(null);
  const { selection } = sel;

  const tooMany = (n: number) =>
    toast.warning(`You can move up to ${fmtNum(MAX_MOVE_ITEMS)} hand-picked deals at once`, {
      id: 'too-many',
      description: `${fmtNum(n)} are selected. To move more, filter the view and select all (Ctrl/⌘+A): the server then moves every match.`,
    });

  /** Select all → a filter the server runs as a job; hand-picked → their IDs, in one request. */
  const runBulk = (entries: MoveEntry[], target: Stage, filter: Query | null) => {
    if (!client.ensureCanEdit()) return; // offline / unreachable: the app says changes are paused
    const moving = entries.filter((e) => e.expected !== target).length; // the rest are already there
    const label = `Move ${plural(moving, 'deal')} → ${STAGE_LABEL[target]}`;
    if (filter) client.moveMatching(filter, target, entries, label);
    else client.moveMany(entries, label);
    sel.clear();
    setConfirm(null);
  };

  /** Selected deals with that status, else the highlighted deal if it has it. */
  const forIssues = (status: 'failed' | 'conflict', fn: (id: string) => void) => {
    const ids = selection.size ? [...selection.keys()] : currentId ? [currentId] : [];
    for (const id of ids) if (client.getView(id)?.status === status) fn(id);
  };

  const commands = useStableCallbacks({
    undo() {
      const r = client.undo();
      if (!r) return void toast('Nothing to undo', { id: 'last-action' });
      if (r.blocked) return; // can't undo right now (the app says why)
      toast(`Undone: ${r.label}`, {
        id: 'last-action',
        description: r.skipped ? `${plural(r.skipped, 'deal')} left alone because ${r.skipped === 1 ? 'it' : 'they'} changed since.` : undefined,
      });
    },

    /** Move exactly one deal (e.g. from the side panel), even if it happens to be selected. */
    moveOne(id: string, target: Stage) {
      const v = client.getView(id);
      if (!v || v.deal.stage === target) return;
      if (!client.move(id, target)) return; // refused while offline / unreachable (the app says why)
      toast(`Moved ${v.deal.name} → ${STAGE_LABEL[target]}`, {
        id: 'last-action',
        action: { label: 'Undo (z)', onClick: commands.undo },
        cancel: { label: 'Show', onClick: () => show(id) }, // find it again, e.g. after the column was re-sorted
      });
    },

    /** Move the selection (if `id` is part of it, or no id given), else that single deal. */
    moveTo(target: Stage, id?: string | null) {
      if (selection.size && (!id || selection.has(id))) {
        const entries = [...selection].map(([sid, expected]) => ({ id: sid, expected, target }));
        if (!client.ensureCanEdit()) return;
        const filter = entries.length > 1 ? sel.whole : null;
        if (!filter && entries.length > MAX_MOVE_ITEMS) return tooMany(entries.length);
        if (entries.length >= CONFIRM_AT) setConfirm({ target, entries, filter });
        else runBulk(entries, target, filter);
        return;
      }
      const dealId = id ?? currentId;
      if (dealId) commands.moveOne(dealId, target);
    },

    /** `[` / `]`: the highlighted deal one stage back or forward. */
    step(dir: 1 | -1) {
      const v = currentId ? client.getView(currentId) : undefined;
      const next = v && STAGES[STAGES.indexOf(v.deal.stage) + dir];
      if (next) commands.moveTo(next, currentId);
    },

    retry: () => forIssues('failed', (id) => client.retry(id)),
    keepTheirs: () => forIssues('conflict', (id) => client.keepTheirs(id)),
    applyMine: () => forIssues('conflict', (id) => client.applyMine(id)),

    /** One conflict group from the Unsaved view. */
    resolveGroup(ids: string[], choice: 'theirs' | 'mine') {
      if (choice === 'mine' && !client.ensureCanEdit()) return;
      const n = client.resolveConflicts(ids, choice);
      sel.selectMany(ids, false);
      toast.success(choice === 'theirs' ? `Kept their change on ${plural(n, 'deal')}` : `Applying your change to ${plural(n, 'deal')}`, {
        id: 'resolve',
        description: choice === 'mine' ? 'Checked against their version: if it changed again, you will see a new conflict.' : undefined,
      });
    },

    confirmBulk() {
      if (confirm) runBulk(confirm.entries, confirm.target, confirm.filter);
    },
    cancelConfirm() {
      setConfirm(null);
    },
  });

  return { confirm, ...commands };
}
