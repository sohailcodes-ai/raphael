/**
 * stateMachine.ts — Explicit presence-state transition table.
 *
 * Defines which transitions are valid, rejects everything else, and provides
 * a safe fallback (error) for unrecoverable requests. Pure logic: no UI, no
 * I/O, fully testable without launching the desktop app.
 */

import type { PresenceState } from "./presenceStates";

/**
 * Valid outgoing transitions per state. Deliberately permissive where the
 * operating cycle demands it (OBSERVE→…→VERIFY→LEARN loops back through
 * thinking), strict where safety demands it:
 *
 * - `executing` may only be entered via approval grant or experiment success
 *   path (thinking -> executing after checks), never straight from dormant.
 * - `verified` is reachable only from experimenting / executing / speaking —
 *   the states where defined checks can actually pass.
 * - `awaiting_approval` pauses executing/experimenting/hypothesizing work.
 */
const TRANSITIONS: Record<PresenceState, readonly PresenceState[]> = {
  dormant: ["listening", "warning"],
  listening: ["thinking", "dormant", "error"],
  thinking: [
    "analyzing",
    "hypothesizing",
    "experimenting",
    "executing",
    "awaiting_approval",
    "speaking",
    "uncertain",
    "warning",
    "error",
    "dormant",
  ],
  analyzing: ["thinking", "hypothesizing", "uncertain", "warning", "error"],
  hypothesizing: [
    "experimenting",
    "thinking",
    "awaiting_approval",
    "uncertain",
    "warning",
    "error",
    "dormant",
  ],
  experimenting: [
    "thinking",
    "hypothesizing",
    "verified",
    "awaiting_approval",
    "uncertain",
    "warning",
    "error",
  ],
  executing: [
    "verified",
    "awaiting_approval",
    "warning",
    "error",
    "speaking",
    "dormant",
  ],
  awaiting_approval: ["executing", "dormant", "error"],
  speaking: ["dormant", "verified", "warning", "error"],
  verified: ["dormant", "listening", "thinking"],
  uncertain: ["thinking", "hypothesizing", "dormant"],
  warning: ["thinking", "dormant", "error"],
  error: ["dormant", "listening", "thinking"],
};

export type TransitionResult =
  | { ok: true; from: PresenceState; to: PresenceState }
  | { ok: false; from: PresenceState; to: PresenceState; reason: string };

export function canTransition(
  from: PresenceState,
  to: PresenceState,
): boolean {
  if (from === to) return true; // self-transition = no-op, always safe
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function validTargets(from: PresenceState): PresenceState[] {
  return [...(TRANSITIONS[from] ?? [])];
}

/**
 * Attempt a transition. Returns a result object — never throws — so the
 * runtime can log rejections as diagnostics instead of crashing.
 */
export function tryTransition(
  from: PresenceState,
  to: PresenceState,
): TransitionResult {
  if (canTransition(from, to)) {
    return { ok: true, from, to };
  }
  return {
    ok: false,
    from,
    to,
    reason: `Invalid presence transition: ${from} -> ${to}`,
  };
}
