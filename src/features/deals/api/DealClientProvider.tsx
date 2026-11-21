import { createContext, useContext, type ReactNode } from 'react';
import type { PipelineClient } from './pipelineClient';

/**
 * The live deal data for this tab. The app creates ONE client and provides it;
 * any feature reads it with useDealClient() (no prop drilling, no import from app/).
 */
const DealClientContext = createContext<PipelineClient | null>(null);

export function DealClientProvider({ client, children }: { client: PipelineClient; children: ReactNode }) {
  return <DealClientContext.Provider value={client}>{children}</DealClientContext.Provider>;
}

export function useDealClient(): PipelineClient {
  const c = useContext(DealClientContext);
  if (!c) throw new Error('useDealClient must be used inside <DealClientProvider>');
  return c;
}
