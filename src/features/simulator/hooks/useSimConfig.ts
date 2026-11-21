import { useEffect, useState } from 'react';
import type { SimConfig, Simulator } from '@mock-server/types';

/** The simulator's current settings, live (they're shared by every open tab). Null without a simulator. */
export function useSimConfig(sim: Simulator): SimConfig;
export function useSimConfig(sim: Simulator | null): SimConfig | null;
export function useSimConfig(sim: Simulator | null): SimConfig | null {
  const [config, setConfig] = useState(() => sim?.getConfig() ?? null);
  useEffect(() => sim?.onConfig(setConfig), [sim]);
  return config;
}
