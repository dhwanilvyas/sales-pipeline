import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { fmtNum } from '@/shared/utils/format';
import { OWNERS, STAGE_LABEL, scopeLabel, type Query, type Scope, type SortKey } from '@/entities/deal';

/** The filter row: search, owner, sort, the result count and the updates menu. */
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'priority', label: 'Priority' }, { key: 'value', label: 'Value' }, { key: 'nextStep', label: 'Follow-up date' },
  { key: 'close', label: 'Close date' }, { key: 'activity', label: 'Last activity' }, { key: 'updated', label: 'Last update' },
  { key: 'name', label: 'Name' }, { key: 'stage', label: 'Stage' }, { key: 'owner', label: 'Owner' },
];

export function Toolbar(props: {
  query: Query;
  count: number;
  /** The "updates from others" menu (rendered at the end of the toolbar). */
  updates?: ReactNode;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearch(s: string): void;
  onScope(s: Scope): void;
  onSort(key: SortKey): void;
  onSearchExit(): void;
}) {
  const { query } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <SearchBox value={query.search} inputRef={props.searchRef} onSearch={props.onSearch} onExit={props.onSearchExit}
          placeholder={query.view === 'all' ? 'Search deal, ID or owner' : 'Search deal or ID'} />
      </div>
      {/* Only All deals has the Owner filter: your views are always your deals. */}
      {query.view === 'all' && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Owner</span>
          <Select value={query.scope} onValueChange={(v) => props.onScope(v as Scope)}>
            <SelectTrigger size="sm" className="w-32" aria-label="Owner (w: me ↔ anyone)"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">{scopeLabel('mine')}</SelectItem>
              <SelectItem value="everyone">{scopeLabel('everyone')}</SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>A teammate</SelectLabel>
                {OWNERS.filter((o) => o !== query.me).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}
      <Select value={query.sort.key} onValueChange={(v) => props.onSort(v as SortKey)}>
        <SelectTrigger size="sm" className="w-44" aria-label="Sort by"><SelectValue /></SelectTrigger>
        <SelectContent>{SORTS.map((s) => <SelectItem key={s.key} value={s.key}>Sort: {s.label}</SelectItem>)}</SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground">
        Showing <strong className="text-foreground">{fmtNum(props.count)}</strong>
        {query.stage && <> · {STAGE_LABEL[query.stage]}</>}
        {query.search && <> · “{query.search}”</>}
      </span>
      {props.updates}
    </div>
  );
}

/**
 * The box keeps its own text and sends it after a short pause. Typing stays
 * instant (URL updates are asynchronous, so a box bound straight to the URL
 * drops keystrokes) and the 50k-deal filter runs once per pause, not per key.
 */
function SearchBox(props: {
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onSearch(s: string): void;
  onExit(): void;
  placeholder: string;
}) {
  const [text, setText] = useState(props.value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Follow outside changes (Back/Forward, switching view), but never while the user is typing here.
  useEffect(() => {
    if (document.activeElement !== props.inputRef.current) setText(props.value);
  }, [props.value, props.inputRef]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const send = (t: string) => {
    clearTimeout(timer.current);
    props.onSearch(t);
  };
  return (
    <Input
      ref={props.inputRef}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => props.onSearch(t), 150);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          send(text);
          props.onExit();
        }
      }}
      placeholder={`${props.placeholder}   /`}
      aria-label="Search deals"
      className="h-8 pl-7"
    />
  );
}
