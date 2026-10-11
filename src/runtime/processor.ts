/**
 * processor.ts — Central event-driven runtime (RaphaelRuntime).
 *
 * Accepts RuntimeEvents, validates them, updates operational state via the
 * state machine, tracks hypotheses/experiments with evidence-grade
 * bookkeeping, enforces approval + verification gates, and emits observable
 * state changes for subscribers (the UI subscribes; it never owns logic).
 *
 * Truthfulness rules enforced here:
 * - A hypothesis is never recorded as a fact.
 * - `verified` requires passing defined checks (see VerificationRecord).
 * - Simulated scenario events are tagged and never reported as real work.
 */

import type { PresenceState } from "./presenceStates";
import {
  EVENT_TARGET_STATE,
  type RuntimeEvent,
  type RuntimeEventType,
} from "./events";
import { tryTransition } from "./stateMachine";

/** Evidence grade of a knowledge record. Hypotheses stay hypotheses. */
export type KnowledgeGrade =
  | "fact" // user-provided or verified observation
  | "user_provided"
  | "assumption" // explicitly unverified
  | "hypothesis" // one of possibly-competing explanations
  | "evidence" // observed measurement / tool output
  | "verified_outcome"; // passed defined checks

export interface HypothesisRecord {
  id: string;
  taskId?: string;
  statement: string;
  grade: KnowledgeGrade;
  status: "proposed" | "supported" | "rejected";
  createdAt: number;
  simulated: boolean;
}

export interface ExperimentRecord {
  id: string;
  taskId?: string;
  hypothesisId?: string;
  description: string;
  status: "running" | "passed" | "failed";
  checks: { name: string; passed: boolean }[];
  createdAt: number;
  finishedAt?: number;
  simulated: boolean;
}

export interface VerificationRecord {
  taskId?: string;
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  at: number;
}

export interface ApprovalRequest {
  id: string;
  taskId?: string;
  operation: string;
  requestedAt: number;
  status: "pending" | "granted" | "denied";
}

export interface StateChange {
  from: PresenceState;
  to: PresenceState;
  event: RuntimeEvent;
  at: number;
}

export interface ProcessOutcome {
  accepted: boolean;
  stateChanged: boolean;
  rejectionReason?: string;
}

const MAX_LOG = 200;

export class RaphaelRuntime {
  private state: PresenceState = "dormant";
  private listeners = new Set<(s: PresenceState, c: StateChange) => void>();
  private eventLog: RuntimeEvent[] = [];
  private changeLog: StateChange[] = [];
  private rejectedLog: { event: RuntimeEvent; reason: string; at: number }[] =
    [];
  private hypotheses: HypothesisRecord[] = [];
  private experiments: ExperimentRecord[] = [];
  private approvals: ApprovalRequest[] = [];
  private verifications: VerificationRecord[] = [];
  private seq = 0;

  getState(): PresenceState {
    return this.state;
  }

  getEventLog(): readonly RuntimeEvent[] {
    return this.eventLog;
  }

  getChangeLog(): readonly StateChange[] {
    return this.changeLog;
  }

  getRejected(): readonly { event: RuntimeEvent; reason: string; at: number }[] {
    return this.rejectedLog;
  }

  getHypotheses(): readonly HypothesisRecord[] {
    return this.hypotheses;
  }

  getExperiments(): readonly ExperimentRecord[] {
    return this.experiments;
  }

  getApprovals(): readonly ApprovalRequest[] {
    return this.approvals;
  }

  getVerifications(): readonly VerificationRecord[] {
    return this.verifications;
  }

  /** Active (not yet granted/denied) approval request, if any. */
  getPendingApproval(): ApprovalRequest | undefined {
    return this.approvals.find((a) => a.status === "pending");
  }

  subscribe(fn: (s: PresenceState, c: StateChange) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(change: StateChange): void {
    for (const fn of this.listeners) {
      try {
        fn(change.to, change);
      } catch {
        // A subscriber must never break the runtime. Ignore and continue.
      }
    }
  }

  private pushLog<T>(arr: T[], item: T): void {
    arr.push(item);
    if (arr.length > MAX_LOG) arr.splice(0, arr.length - MAX_LOG);
  }

  /** Validate an event's shape before processing. */
  private validate(event: RuntimeEvent): string | null {
    if (!event || typeof event !== "object") return "Event must be an object";
    if (!event.id || typeof event.id !== "string") return "Event id missing";
    if (!event.type || !(event.type in EVENT_TARGET_STATE))
      return `Unknown event type: ${String((event as { type?: unknown }).type)}`;
    if (typeof event.timestamp !== "number") return "Event timestamp missing";
    if (!event.source) return "Event source missing";
    return null;
  }

  /**
   * Main entry point. Validates the event, records hypothesis/experiment/
   * approval bookkeeping, then attempts the state transition dictated by
   * EVENT_TARGET_STATE. Invalid transitions are rejected and logged — the
   * state is left untouched (safe fallback).
   */
  process(raw: RuntimeEvent): ProcessOutcome {
    const shapeError = this.validate(raw);
    if (shapeError) {
      this.pushLog(this.rejectedLog, {
        event: raw,
        reason: shapeError,
        at: Date.now(),
      });
      return { accepted: false, stateChanged: false, rejectionReason: shapeError };
    }

    const event = raw as RuntimeEvent & { type: RuntimeEventType };
    this.pushLog(this.eventLog, event);
    this.bookkeep(event);

    // Verification gate: `verified` requires passing checks in the payload.
    if (event.type === "verified") {
      const checks = payloadChecks(event);
      const passed = checks.length > 0 && checks.every((c) => c.passed);
      this.pushLog(this.verifications, {
        taskId: event.taskId,
        checks,
        passed,
        at: Date.now(),
      });
      if (!passed) {
        const reason =
          "Verification gate: 'verified' requires at least one passing check in payload.checks";
        this.pushLog(this.rejectedLog, { event, reason, at: Date.now() });
        return { accepted: false, stateChanged: false, rejectionReason: reason };
      }
    }

    // Approval gate: execution-affecting events while an approval is pending
    // are held — the runtime must be in awaiting_approval first.
    if (
      (event.type === "execution.started" || event.type === "approval.granted") &&
      this.state !== "awaiting_approval" &&
      this.state !== "thinking" &&
      this.state !== "dormant"
    ) {
      // Allow the transition attempt below to decide; this gate only guards
      // the specific unsafe jump dormant->executing etc. via state machine.
    }

    const target = EVENT_TARGET_STATE[event.type];
    const result = tryTransition(this.state, target);
    if (!result.ok) {
      this.pushLog(this.rejectedLog, {
        event,
        reason: result.reason,
        at: Date.now(),
      });
      return {
        accepted: false,
        stateChanged: false,
        rejectionReason: result.reason,
      };
    }

    const from = this.state;
    const changed = from !== target;
    this.state = target;
    this.seq += 1;
    if (changed) {
      const change: StateChange = { from, to: target, event, at: Date.now() };
      this.pushLog(this.changeLog, change);
      this.emit(change);
    }
    return { accepted: true, stateChanged: changed };
  }

  /** Side-bookkeeping: hypothesis / experiment / approval registries. */
  private bookkeep(event: RuntimeEvent): void {
    const p = event.payload ?? {};
    const str = (v: unknown, fb: string): string =>
      typeof v === "string" && v.length > 0 ? v : fb;
    switch (event.type) {
      case "hypotheses.proposed": {
        const items = Array.isArray(p["statements"])
          ? (p["statements"] as unknown[])
          : [];
        items.slice(0, 8).forEach((s, i) => {
          this.pushLog(this.hypotheses, {
            id: `${event.id}:h${i}`,
            taskId: event.taskId,
            statement: str(s, `Hypothesis ${i + 1}`),
            grade: "hypothesis",
            status: "proposed",
            createdAt: event.timestamp,
            simulated: event.simulated,
          });
        });
        break;
      }
      case "hypothesis.rejected": {
        const id = p["hypothesisId"];
        const rec =
          typeof id === "string"
            ? this.hypotheses.find((h) => h.id === id)
            : this.hypotheses.filter((h) => h.status === "proposed").pop();
        if (rec) rec.status = "rejected";
        break;
      }
      case "experiment.started": {
        this.pushLog(this.experiments, {
          id: str(p["experimentId"], event.id),
          taskId: event.taskId,
          hypothesisId:
            typeof p["hypothesisId"] === "string"
              ? (p["hypothesisId"] as string)
              : undefined,
          description: str(p["description"], "Experiment"),
          status: "running",
          checks: [],
          createdAt: event.timestamp,
          simulated: event.simulated,
        });
        break;
      }
      case "experiment.completed": {
        const rec = this.experiments.filter((e) => e.status === "running").pop();
        if (rec) {
          rec.status = "passed";
          rec.checks = payloadChecks(event);
          rec.finishedAt = Date.now();
        }
        break;
      }
      case "experiment.failed": {
        const rec = this.experiments.filter((e) => e.status === "running").pop();
        if (rec) {
          rec.status = "failed";
          rec.checks = payloadChecks(event);
          rec.finishedAt = Date.now();
        }
        break;
      }
      case "approval.requested": {
        this.pushLog(this.approvals, {
          id: str(p["approvalId"], event.id),
          taskId: event.taskId,
          operation: str(p["operation"], "Operation"),
          requestedAt: event.timestamp,
          status: "pending",
        });
        break;
      }
      case "approval.granted": {
        const pending = this.getPendingApproval();
        if (pending) pending.status = "granted";
        break;
      }
      case "approval.denied": {
        const pending = this.getPendingApproval();
        if (pending) pending.status = "denied";
        break;
      }
      default:
        break;
    }
  }

  /** Reset to a clean slate (development use). Real history stays in logs. */
  reset(): void {
    this.state = "dormant";
    this.hypotheses = [];
    this.experiments = [];
    this.approvals = [];
    this.verifications = [];
  }
}

function payloadChecks(event: RuntimeEvent): { name: string; passed: boolean }[] {
  const raw = event.payload?.["checks"];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is { name?: unknown; passed?: unknown } =>
        typeof c === "object" && c !== null,
    )
    .map((c, i) => ({
      name: typeof c.name === "string" ? c.name : `check-${i + 1}`,
      passed: c.passed === true,
    }));
}
