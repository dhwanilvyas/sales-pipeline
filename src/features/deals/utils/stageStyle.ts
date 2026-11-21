import type { Stage } from '@/entities/deal/deal.types';

/** One colour per stage, used wherever a stage is shown. */
export const STAGE_STYLE: Record<Stage, string> = {
  new: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  contacted: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  demo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  proposal: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  negotiation: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  won: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  lost: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
};
