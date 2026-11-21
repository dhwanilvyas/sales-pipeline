import { KanbanSquare, Table2 } from 'lucide-react';
import type { Layout } from '@/features/deals/types';
import { SegmentedControl } from '@/shared/ui/segmented-control';

/** The small Board/Table icon switch (also `b`). */
export function LayoutSwitch(props: { layout: Layout; onLayout(l: Layout): void }) {
  return (
    <SegmentedControl
      label="Layout"
      shortcut="b"
      iconOnly
      value={props.layout}
      onChange={props.onLayout}
      options={[
        { value: 'board', label: 'Board', icon: KanbanSquare },
        { value: 'table', label: 'Table', icon: Table2 },
      ]}
    />
  );
}
