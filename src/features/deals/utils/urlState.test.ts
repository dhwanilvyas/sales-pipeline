import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, isNavigation, parseViewState, writeViewState } from './urlState';
import type { ViewState } from '@/features/deals/types';
import { DEFAULT_SORT } from '@/entities/deal';

const p = (s: string) => new URLSearchParams(s);

describe('url state', () => {
  it('everyone lands on a board of their own deals', () => {
    expect(parseViewState(p(''))).toEqual(DEFAULT_VIEW);
    expect(DEFAULT_VIEW).toMatchObject({ layout: 'board', view: 'open', scope: 'mine' });
  });

  it('round-trips a shared link', () => {
    const s: ViewState = { layout: 'table', view: 'all', scope: 'everyone', stage: 'negotiation', search: 'acme', sort: { key: 'value', dir: 'desc' } };
    const url = writeViewState(p(''), s);
    expect(url.toString()).toBe('layout=table&view=all&whose=everyone&stage=negotiation&q=acme&sort=value-desc');
    expect(parseViewState(url)).toEqual(s);
  });

  it('keeps unrelated params like ?user=', () => {
    expect(writeViewState(p('user=Rahul'), DEFAULT_VIEW).get('user')).toBe('Rahul');
  });

  it('missing params use the default; the sort defaults per view', () => {
    const s = parseViewState(p('view=stale'));
    expect(s.layout).toBe('board');
    expect(s.view).toBe('stale');
    expect(s.sort).toEqual(DEFAULT_SORT.stale);
  });

  it('bad values fall back instead of breaking', () => {
    expect(parseViewState(p('layout=3d&view=nope&whose=nobody&stage=closed&sort=hack-sideways'))).toEqual(DEFAULT_VIEW);
  });

  it('All deals: a specific teammate, case-insensitive; anyone by default', () => {
    expect(parseViewState(p('view=all&whose=rahul')).scope).toBe('Rahul');
    expect(parseViewState(p('view=all')).scope).toBe('everyone');
  });

  it('your views are always yours: the Owner param is ignored and not written', () => {
    expect(parseViewState(p('view=stale&whose=rahul')).scope).toBe('mine');
    expect(writeViewState(p(''), { ...DEFAULT_VIEW, view: 'stale' }).has('whose')).toBe(false);
  });

  it('only layout/view/whose/stage changes count as navigation', () => {
    const base = DEFAULT_VIEW;
    expect(isNavigation(base, { ...base, search: 'x' })).toBe(false);
    expect(isNavigation(base, { ...base, sort: { key: 'value', dir: 'asc' } })).toBe(false);
    expect(isNavigation(base, { ...base, layout: 'table' })).toBe(true);
    expect(isNavigation(base, { ...base, stage: 'won' })).toBe(true);
  });
});
