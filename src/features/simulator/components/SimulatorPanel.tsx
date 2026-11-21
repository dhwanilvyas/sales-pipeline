import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { Separator } from '@/shared/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { Slider } from '@/shared/ui/slider';
import { Switch } from '@/shared/ui/switch';
import type { SimConfig, Simulator } from '@mock-server/types';
import { useSimConfig } from '@/features/simulator/hooks/useSimConfig';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { OWNERS } from '@/entities/deal';

function Row(props: { label: string; value: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>{props.label}</Label>
        <span className="text-sm tabular-nums text-muted-foreground">{props.value}</span>
      </div>
      {props.children}
      {props.hint && <p className="text-xs text-muted-foreground">{props.hint}</p>}
    </div>
  );
}

/**
 * There's no login, so to see two people clash, open a second tab as a
 * teammate. It opens on All deals filtered to YOUR deals (layout and stage kept),
 * so you can both act on the same ones.
 */
export function teammateUrl(teammate: string, me: string, href = window.location.href): string {
  const url = new URL(href);
  url.searchParams.set('user', teammate);
  const whose = url.searchParams.get('view') === 'all' ? url.searchParams.get('whose') : 'mine';
  url.searchParams.set('view', 'all');
  url.searchParams.set('whose', !whose || whose === 'mine' ? me.toLowerCase() : whose);
  url.searchParams.delete('sort');
  return url.toString();
}

function People(props: { me: string; shared: boolean }) {
  const others = OWNERS.filter((o) => o !== props.me);
  const [teammate, setTeammate] = useState<string>(others[0]);
  return (
    <div className="space-y-2">
      <Label>People</Label>
      <p className="text-sm">In this tab you are <strong>{props.me}</strong>.</p>
      <div className="flex gap-2">
        <Select value={teammate} onValueChange={setTeammate}>
          <SelectTrigger size="sm" className="w-32" aria-label="Teammate"><SelectValue /></SelectTrigger>
          <SelectContent>{others.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="flex-1" disabled={!props.shared}
          onClick={() => window.open(teammateUrl(teammate, props.me), `pipeline-${teammate}`)}>
          Open a tab as {teammate}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {props.shared
          ? `${teammate}'s tab opens on All deals showing ${props.me}'s deals, the same ones you see, so you can both move them and cause conflicts. Keep at least one window open: closing all of them resets the fake server.`
          : 'Not available: this browser has no SharedWorker, so tabs cannot share one fake server.'}
      </p>
    </div>
  );
}

/** Changes are kept across reloads; this starts over with fresh sample data (every open tab reloads). */
function ResetData({ backend }: { backend: Simulator }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <div className="space-y-2">
      <Label>Data</Label>
      <p className="text-xs text-muted-foreground">
        {backend.shared
          ? 'Changes are saved in this browser and survive reloads. Reset to start again from fresh sample data.'
          : 'This browser has no SharedWorker: data lives in this tab only and resets on reload.'}
      </p>
      <Button size="sm" variant={armed ? 'destructive' : 'outline'} className="w-full"
        onClick={() => (armed ? backend.resetDemoData() : setArmed(true))}>
        {armed ? 'Click again: discard all changes and reload every tab' : 'Reset demo data'}
      </Button>
    </div>
  );
}

/** The simulator (`` ` ``): network, failures, teammates, people. Controls the shared fake backend. */
export function SimulatorPanel(props: { open: boolean; onClose(): void; backend: Simulator; me: string }) {
  const { backend } = props;
  const c = useSimConfig(backend);
  const set = (patch: Partial<SimConfig>) => backend.setConfig(patch);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <Sheet open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <SheetContent className="w-[380px] overflow-y-auto sm:max-w-[380px]">
        <SheetHeader>
          <SheetTitle>Simulator</SheetTitle>
          <SheetDescription>
            Controls the fake backend. {backend.shared ? 'Shared by every open tab.' : 'This tab only (no SharedWorker).'}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <People me={props.me} shared={backend.shared} />
          <Separator />
          <div className="flex items-center justify-between">
            <Label htmlFor="online">Online</Label>
            <Switch id="online" checked={c.online} onCheckedChange={(v) => set({ online: v })} />
          </div>
          <Row label="Save latency" value={`${c.latencyMinMs}–${c.latencyMaxMs} ms`}>
            <Slider min={0} max={5000} step={100} value={[c.latencyMinMs, c.latencyMaxMs]}
              onValueChange={([a, b]) => set({ latencyMinMs: a, latencyMaxMs: b })} />
          </Row>
          <Row label="Failed saves" value={pct(c.failureRate)} hint="Share of save requests that fail on the network. Some of those reach the server but the reply is lost: retries must not save twice.">
            <Slider min={0} max={1} step={0.05} value={[c.failureRate]} onValueChange={([v]) => set({ failureRate: v })} />
          </Row>
          <Row label="Rejected deals" value={pct(c.itemFailureRate)} hint="The server answers but refuses a deal (e.g. locked). In bulk moves: partial failure.">
            <Slider min={0} max={1} step={0.01} value={[c.itemFailureRate]} onValueChange={([v]) => set({ itemFailureRate: v })} />
          </Row>
          <Separator />
          <ResetData backend={backend} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
