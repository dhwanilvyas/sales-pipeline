import { useSyncExternalStore } from 'react';
import type { PipelineClient } from '@/features/deals/api/pipelineClient';

/** Re-render when the client's data changes (batched per tick by the client). */
export function useClientRev(client: PipelineClient): number {
  return useSyncExternalStore(client.subscribe, client.getRev);
}
