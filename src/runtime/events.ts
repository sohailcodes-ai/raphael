/**
 * events.ts — Typed runtime event contract.
 *
 * UI components dispatch RuntimeEvents; the central processor validates them,
 * drives the state machine, and emits observable state changes. The UI never
 * owns this business logic — it subscribes.
 */

import type { PresenceState } from "./presenceStates";

/** Sources that may emit events. Restricted to known subsystems. */
export type EventSource =
  | "user"
  | "scenario" // explicitly-labelled development simulation
  | "analysis"
  | "hypothesis"
  | "experiment"
  | "executor"
  | "approval"
  | "verifier"
  | "speech"
  | "system";

/** Discriminated event types. */
export type RuntimeEventType =
  | "input.received"
  | "processing.started"
  | "analysis.started"
  | "analysis.completed"
  | "hypotheses.proposed"
  | "hypothesis.rejected"
  | "experiment.started"
  | "experiment.completed"
  | "experiment.failed"
  | "execution.started"
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  | "speech.started"
  | "speech.ended"
  | "verified"
  | "uncertainty.raised"
  | "warning.raised"
  | "error.raised"
  | "reset";

export interface RuntimeEvent {
  /** Unique event identifier (client-generated UUID). */
  id: string;
  type: RuntimeEventType;
  /** Unix epoch milliseconds. */
  timestamp: number;
  source: EventSource;
  /** Related task identifier, when the event belongs to a task. */
  taskId?: string;
  /** Correlation id linking causation chains (e.g. experiment -> verdict). */
  correlationId?: string;
  /** True only for the labelled development scenario runner. Never real work. */
  simulated: boolean;
  payload?: Record<string, unknown>;
}

export function createEvent(
  type: RuntimeEventType,
  source: EventSource,
  options?: {
    taskId?: string;
    correlationId?: string;
    simulated?: boolean;
    payload?: Record<string, unknown>;
    id?: string;
    timestamp?: number;
  },
): RuntimeEvent {
  return {
    id:
      options?.id ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `evt-${Date.now()}-${Math.floor(Math.random() * 1e9)}`),
    type,
    timestamp: options?.timestamp ?? Date.now(),
    source,
    taskId: options?.taskId,
    correlationId: options?.correlationId,
    simulated: options?.simulated ?? false,
    payload: options?.payload,
  };
}

/** Maps each event type to the presence state it requests. */
export const EVENT_TARGET_STATE: Record<RuntimeEventType, PresenceState> = {
  "input.received": "listening",
  "processing.started": "thinking",
  "analysis.started": "analyzing",
  "analysis.completed": "thinking",
  "hypotheses.proposed": "hypothesizing",
  "hypothesis.rejected": "hypothesizing",
  "experiment.started": "experimenting",
  "experiment.completed": "thinking",
  "experiment.failed": "error",
  "execution.started": "executing",
  "approval.requested": "awaiting_approval",
  "approval.granted": "executing",
  "approval.denied": "dormant",
  "speech.started": "speaking",
  "speech.ended": "dormant",
  verified: "verified",
  "uncertainty.raised": "uncertain",
  "warning.raised": "warning",
  "error.raised": "error",
  reset: "dormant",
};
