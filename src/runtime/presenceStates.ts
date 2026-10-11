/**
 * presenceStates.ts — Typed presence-state model for the RAPHAEL Sigil.
 *
 * One coherent visual system driven by actual runtime state. The UI never
 * picks animations directly; it renders whatever state the runtime holds.
 * Transitions are validated by stateMachine.ts.
 */

/** All operational presence states. Exactly the 13 required states. */
export type PresenceState =
  | "dormant"
  | "listening"
  | "thinking"
  | "analyzing"
  | "hypothesizing"
  | "experimenting"
  | "executing"
  | "awaiting_approval"
  | "speaking"
  | "verified"
  | "uncertain"
  | "warning"
  | "error";

export const ALL_PRESENCE_STATES: readonly PresenceState[] = [
  "dormant",
  "listening",
  "thinking",
  "analyzing",
  "hypothesizing",
  "experimenting",
  "executing",
  "awaiting_approval",
  "speaking",
  "verified",
  "uncertain",
  "warning",
  "error",
] as const;

/** Human-readable label + operational description per state. */
export const PRESENCE_META: Record<
  PresenceState,
  { label: string; description: string }
> = {
  dormant: {
    label: "Dormant",
    description: "Quiet. Minimal motion. No active task.",
  },
  listening: {
    label: "Listening",
    description: "Reacting to incoming voice or input.",
  },
  thinking: {
    label: "Thinking",
    description: "Active processing of a request or task step.",
  },
  analyzing: {
    label: "Analyzing",
    description: "Inspecting information from a permitted source.",
  },
  hypothesizing: {
    label: "Hypothesizing",
    description: "Exploring competing explanations. None are facts yet.",
  },
  experimenting: {
    label: "Experimenting",
    description: "Conducting an actual test with defined checks.",
  },
  executing: {
    label: "Executing",
    description: "Performing an approved operation.",
  },
  awaiting_approval: {
    label: "Awaiting approval",
    description: "Paused. A proposed operation needs user permission.",
  },
  speaking: {
    label: "Speaking",
    description: "Linked to actual speech output activity.",
  },
  verified: {
    label: "Verified",
    description: "A defined success condition has passed its checks.",
  },
  uncertain: {
    label: "Uncertain",
    description: "Insufficient evidence for a reliable conclusion.",
  },
  warning: {
    label: "Warning",
    description: "A meaningful risk or condition needs attention.",
  },
  error: {
    label: "Error",
    description: "An operation has failed. See diagnostics.",
  },
};

export function isPresenceState(value: unknown): value is PresenceState {
  return (
    typeof value === "string" &&
    (ALL_PRESENCE_STATES as readonly string[]).includes(value)
  );
}
