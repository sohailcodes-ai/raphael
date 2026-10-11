/**
 * boundaries.ts — Future-compatible capability interfaces.
 *
 * Only the seams the current milestone (or its immediate next step) benefits
 * from are defined here. Each interface matches its actual responsibility.
 * No fake implementations — adapters arrive with the milestones that need
 * them (see docs/ROADMAP.md).
 */

import type { RuntimeEvent } from "./events";

/** Generates text / decisions. Local-first; replaceable, never required. */
export interface ModelProvider {
  readonly name: string;
  complete(prompt: string, options?: { maxTokens?: number }): Promise<string>;
}

/** Persistent memory: projects, goals, decisions, preferences, history. */
export interface MemoryStore {
  remember(key: string, value: unknown): Promise<void>;
  recall<T>(key: string): Promise<T | undefined>;
  forget(key: string): Promise<void>;
}

/** Result of a tool invocation, kept evidence-grade. */
export interface ToolResult {
  ok: boolean;
  output: string;
  exitCode?: number;
  durationMs: number;
}

/**
 * Executes inspected operations. v0.1 has no implementation: the boundary
 * exists so the approval policy can be designed against it. Read-only
 * inspection, proposed changes, approval-required operations, and verified
 * execution must stay distinguishable (see docs/ARCHITECTURE.md).
 */
export interface ToolExecutor {
  inspect(command: string): Promise<ToolResult>;
  propose(command: string): Promise<{ proposalId: string; summary: string }>;
  executeApproved(proposalId: string, approvalToken: string): Promise<ToolResult>;
}

/** Versioned reusable skills. Promotion requires validation (ROADMAP §5). */
export interface SkillRegistry {
  propose(name: string, procedure: string): Promise<{ version: number }>;
  validate(name: string, version: number): Promise<{ passed: boolean; report: string }>;
  promote(name: string, version: number): Promise<void>;
}

/** Runs an experiment's defined checks and reports pass/fail. */
export interface ExperimentRunner {
  run(
    experimentId: string,
    checks: { name: string; run: () => Promise<boolean> }[],
  ): Promise<{ passed: boolean; results: { name: string; passed: boolean }[] }>;
}

/** Decides whether an operation needs user approval before execution. */
export interface ApprovalPolicy {
  requiresApproval(operation: string): boolean;
  requestApproval(operation: string): Promise<{ approvalId: string }>;
}

/** Publishes runtime events to external observers (logs, future services). */
export interface EventPublisher {
  publish(event: RuntimeEvent): void;
}
