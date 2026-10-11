/**
 * useRuntime.ts — React binding for RaphaelRuntime.
 *
 * Subscribes to the singleton runtime and re-renders on state changes.
 * Components never mutate runtime state directly; they dispatch events.
 */

import { useEffect, useReducer } from "react";
import type { PresenceState } from "../runtime/presenceStates";
import { RaphaelRuntime } from "../runtime/processor";

export const runtime = new RaphaelRuntime();

export function usePresence(): PresenceState {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => runtime.subscribe(() => force()), []);
  return runtime.getState();
}
