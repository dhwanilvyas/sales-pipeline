import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/shared/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { STAGES, STAGE_LABEL, type Stage } from '@/entities/deal';

/** Centred picker for moving a multi-selection (single deals use the dropdown on their row/card). */
export function StagePicker(props: { open: boolean; title: string; current: Stage | null; onPick(s: Stage): void; onClose(): void }) {
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="top-1/3 max-w-sm translate-y-0 overflow-hidden p-0" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Move to stage</DialogTitle>
          <DialogDescription>{props.title}</DialogDescription>
        </DialogHeader>
        <Command
          onKeyDown={(e) => {
            const n = Number(e.key);
            if (n >= 1 && n <= STAGES.length && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              props.onPick(STAGES[n - 1]);
            }
          }}
        >
          <CommandInput placeholder={`Move ${props.title} to…`} />
          <CommandList>
            <CommandEmpty>No stage found.</CommandEmpty>
            <CommandGroup>
              {STAGES.map((s, i) => (
                <CommandItem key={s} value={STAGE_LABEL[s]} onSelect={() => props.onPick(s)} disabled={s === props.current}>
                  {STAGE_LABEL[s]}
                  {s === props.current && <span className="text-xs text-muted-foreground">current</span>}
                  <CommandShortcut>{i + 1}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

