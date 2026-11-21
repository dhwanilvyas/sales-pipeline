import { PIPELINES } from '@/entities/deal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

/** Which pipeline (only one exists today; the dropdown shows where more would go). Shown next to the page title. */
export function PipelineSelect() {
  return (
    <Select value={PIPELINES[0].id}>
      <SelectTrigger size="sm" className="w-40" aria-label="Pipeline"><SelectValue /></SelectTrigger>
      <SelectContent>
        {PIPELINES.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
