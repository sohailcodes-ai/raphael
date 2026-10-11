/**
 * scenarios.ts — Truthful development scenario runner.
 *
 * Every event emitted here carries `simulated: true` and the UI labels the
 * runner as SIMULATION. Simulated hypotheses/completions must never appear
 * as real AI analysis or real tool execution.
 */

import { createEvent, type RuntimeEvent } from "./events";

export interface ScenarioStep {
  label: string;
  detail: string;
  build: (taskId: string) => RuntimeEvent;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  steps: ScenarioStep[];
}

function step(
  label: string,
  detail: string,
  build: (taskId: string) => RuntimeEvent,
): ScenarioStep {
  return { label, detail, build };
}

let taskSeq = 0;
export function nextTaskId(): string {
  taskSeq += 1;
  return `sim-task-${taskSeq}`;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "observe-model-hypothesize",
    title: "Observe → Hypothesize",
    description:
      "Input arrives, analysis runs, competing hypotheses are proposed. All simulated.",
    steps: [
      step("Input arrives", "input.received → listening", (t) =>
        createEvent("input.received", "scenario", {
          taskId: t,
          simulated: true,
          payload: { summary: "Simulated user request" },
        }),
      ),
      step("Processing", "processing.started → thinking", (t) =>
        createEvent("processing.started", "scenario", {
          taskId: t,
          simulated: true,
        }),
      ),
      step("Analysis", "analysis.started → analyzing", (t) =>
        createEvent("analysis.started", "scenario", {
          taskId: t,
          simulated: true,
          payload: { source: "simulated permitted source" },
        }),
      ),
      step("Back to thinking", "analysis.completed → thinking", (t) =>
        createEvent("analysis.completed", "scenario", {
          taskId: t,
          simulated: true,
          payload: { findings: ["simulated finding A"] },
        }),
      ),
      step("Two hypotheses", "hypotheses.proposed → hypothesizing", (t) =>
        createEvent("hypotheses.proposed", "scenario", {
          taskId: t,
          simulated: true,
          payload: {
            statements: [
              "Simulated hypothesis 1 (unverified)",
              "Simulated hypothesis 2 (competing, unverified)",
            ],
          },
        }),
      ),
    ],
  },
  {
    id: "experiment-verify",
    title: "Experiment → Verified",
    description:
      "A simulated experiment runs with passing checks, then verifies. Rejects one path first.",
    steps: [
      step("Input arrives", "input.received → listening", (t) =>
        createEvent("input.received", "scenario", { taskId: t, simulated: true }),
      ),
      step("Processing", "processing.started → thinking", (t) =>
        createEvent("processing.started", "scenario", {
          taskId: t,
          simulated: true,
        }),
      ),
      step("Hypotheses", "hypotheses.proposed → hypothesizing", (t) =>
        createEvent("hypotheses.proposed", "scenario", {
          taskId: t,
          simulated: true,
          payload: { statements: ["H1: simulated cause", "H2: rival cause"] },
        }),
      ),
      step("Experiment starts", "experiment.started → experimenting", (t) =>
        createEvent("experiment.started", "scenario", {
          taskId: t,
          simulated: true,
          payload: { description: "Simulated test of H1", experimentId: `${t}-exp1` },
        }),
      ),
      step("Reject rival", "hypothesis.rejected (stays hypothesizing data-wise)", (t) =>
        createEvent("hypothesis.rejected", "scenario", {
          taskId: t,
          simulated: true,
          payload: { note: "H2 rejected by simulated evidence" },
        }),
      ),
      step("Experiment passes", "experiment.completed → thinking", (t) =>
        createEvent("experiment.completed", "scenario", {
          taskId: t,
          simulated: true,
          payload: { checks: [{ name: "simulated check", passed: true }] },
        }),
      ),
      step("Execute", "execution.started → executing", (t) =>
        createEvent("execution.started", "scenario", {
          taskId: t,
          simulated: true,
        }),
      ),
      step("Verified", "verified → verified (checks passed)", (t) =>
        createEvent("verified", "scenario", {
          taskId: t,
          simulated: true,
          payload: { checks: [{ name: "defined success condition", passed: true }] },
        }),
      ),
    ],
  },
  {
    id: "approval-flow",
    title: "Approval gate",
    description:
      "Work pauses for permission; grant resumes, deny stands down. Simulated.",
    steps: [
      step("Input arrives", "input.received → listening", (t) =>
        createEvent("input.received", "scenario", { taskId: t, simulated: true }),
      ),
      step("Processing", "processing.started → thinking", (t) =>
        createEvent("processing.started", "scenario", {
          taskId: t,
          simulated: true,
        }),
      ),
      step("Approval requested", "approval.requested → awaiting_approval", (t) =>
        createEvent("approval.requested", "scenario", {
          taskId: t,
          simulated: true,
          payload: { operation: "Simulated write operation", approvalId: `${t}-appr` },
        }),
      ),
      step("Approval granted", "approval.granted → executing", (t) =>
        createEvent("approval.granted", "scenario", {
          taskId: t,
          simulated: true,
        }),
      ),
      step("Verified", "verified with passing checks", (t) =>
        createEvent("verified", "scenario", {
          taskId: t,
          simulated: true,
          payload: { checks: [{ name: "post-execution check", passed: true }] },
        }),
      ),
    ],
  },
  {
    id: "failure-uncertainty",
    title: "Failure, uncertainty, invalid",
    description:
      "Exercises experiment.failed, uncertainty, warning, an invalid jump, and a verification-gate rejection.",
    steps: [
      step("Input arrives", "input.received → listening", (t) =>
        createEvent("input.received", "scenario", { taskId: t, simulated: true }),
      ),
      step("Processing", "processing.started → thinking", (t) =>
        createEvent("processing.started", "scenario", {
          taskId: t,
          simulated: true,
        }),
      ),
      step("Experiment starts", "experiment.started → experimenting", (t) =>
        createEvent("experiment.started", "scenario", {
          taskId: t,
          simulated: true,
          payload: { description: "Simulated fragile test" },
        }),
      ),
      step("Experiment fails", "experiment.failed → error", (t) =>
        createEvent("experiment.failed", "scenario", {
          taskId: t,
          simulated: true,
          payload: {
            error: "Simulated failure (not a real failure)",
            checks: [{ name: "simulated check", passed: false }],
          },
        }),
      ),
      step("Recover to thinking", "processing.started → thinking", (t) =>
        createEvent("processing.started", "scenario", {
          taskId: t,
          simulated: true,
        }),
      ),
      step("Uncertain", "uncertainty.raised → uncertain", (t) =>
        createEvent("uncertainty.raised", "scenario", {
          taskId: t,
          simulated: true,
          payload: { reason: "Insufficient simulated evidence" },
        }),
      ),
      step("Invalid: unverified claim", "verified with NO passing checks → rejected by gate", (t) =>
        createEvent("verified", "scenario", {
          taskId: t,
          simulated: true,
          payload: { checks: [] },
        }),
      ),
      step("Warning", "processing → thinking, then warning", (t) =>
        createEvent("processing.started", "scenario", {
          taskId: t,
          simulated: true,
        }),
      ),
      step("Raise warning", "warning.raised → warning", (t) =>
        createEvent("warning.raised", "scenario", {
          taskId: t,
          simulated: true,
          payload: { risk: "Simulated risk needing attention" },
        }),
      ),
      step("Stand down", "reset → dormant", (t) =>
        createEvent("reset", "scenario", { taskId: t, simulated: true }),
      ),
    ],
  },
];
