/**
 * boundaries.ts — Future-compatible capability interfaces.
 *
 * Only the seams the current milestone (or its immediate next step) benefits
 * from are defined here. Each interface matches its actual responsibility.
 * No fake implementations — adapters arrive with the milestones that need
 * them (see docs/ROADMAP.md).
 */

import type { RuntimeEvent } from "./events";

/* ---------------------------------------------------------------- model */

/** A single chat message used in bounded model context. */
export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Describes one installed model available to a provider. */
export interface ModelDescriptor {
  readonly id: string;
  readonly name: string;
  readonly size?: number;
  readonly digest?: string;
}

/** Connection + capability status reported to the UI. */
export interface ProviderStatus {
  readonly connected: boolean;
  readonly model?: string;
  readonly models: ModelDescriptor[];
  readonly error?: string; // user-safe only, never internals
}

/** Generates text from conversation history. Local-first; replaceable. */
export interface ModelProvider {
  readonly name: string;
  /** Current connection + model status. May reject if the service is unreachable. */
  status(): Promise<ProviderStatus>;
  /** List models actually installed on the local service. Never pulls/downloads. */
  listModels(): Promise<ModelDescriptor[]>;
  /** Select the model for subsequent `complete` calls. Throws on unknown id. */
  selectModel(id: string): void;
  /**
   * Run inference over bounded conversation history.
   * `options.signal` enables cancellation; `options.maxTokens` bounds output.
   */
  complete(
    messages: ModelMessage[],
    options?: { maxTokens?: number; signal?: AbortSignal },
  ): Promise<string>;
  /** Cancel any in-flight inference for this provider instance. */
  abort(): void;
}

/* ---------------------------------------------------------------- memory */

export type MemoryKind = "fact" | "preference" | "observation";

export interface UserMemory {
  id: string;
  kind: MemoryKind;
  statement: string;
  source: "user-approved";
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Goal {
  id: string;
  projectId?: string;
  title: string;
  status: "open" | "done" | "dropped";
  createdAt: number;
  updatedAt: number;
}

export interface Decision {
  id: string;
  projectId?: string;
  goalId?: string;
  title: string;
  summary: string;
  createdAt: number;
}

export interface TaskSession {
  id: string;
  conversationId?: string;
  projectId?: string;
  status: "open" | "closed";
  startedAt: number;
  closedAt?: number;
}

/** Persistent, versioned, local-first memory. All operations are transactional. */
export interface MemoryStore {
  readonly driver: string;
  readonly version: number;
  ping(): Promise<void>;

  // conversations
  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  createConversation(title?: string): Promise<Conversation>;
  updateConversation(id: string, patch: Partial<Conversation>): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  // messages
  addMessage(message: Omit<StoredMessage, "id">): Promise<StoredMessage>;
  listMessages(conversationId: string): Promise<StoredMessage[]>;
  updateMessage(id: string, patch: { content?: string }): Promise<void>;
  deleteMessage(id: string): Promise<void>;

  // user-approved memories (never model assumptions)
  listUserMemories(): Promise<UserMemory[]>;
  addUserMemory(memory: Omit<UserMemory, "id" | "createdAt" | "updatedAt">): Promise<UserMemory>;
  updateUserMemory(id: string, patch: Partial<UserMemory>): Promise<void>;
  deleteUserMemory(id: string): Promise<void>;

  // projects / goals / decisions / sessions
  listProjects(): Promise<Project[]>;
  createProject(project: Omit<Project, "id">): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<void>;
  deleteProject(id: string): Promise<void>;

  listGoals(): Promise<Goal[]>;
  createGoal(goal: Omit<Goal, "id">): Promise<Goal>;
  updateGoal(id: string, patch: Partial<Goal>): Promise<void>;
  deleteGoal(id: string): Promise<void>;

  listDecisions(): Promise<Decision[]>;
  createDecision(decision: Omit<Decision, "id">): Promise<Decision>;
  deleteDecision(id: string): Promise<void>;

  listTaskSessions(): Promise<TaskSession[]>;
  createTaskSession(session: Omit<TaskSession, "id">): Promise<TaskSession>;
  closeTaskSession(id: string): Promise<void>;

  // bounded context retrieval for model prompts
  retrieveContext(conversationId: string, options?: {
    maxMessages?: number;
    maxChars?: number;
    includeMemories?: boolean;
  }): Promise<{ messages: StoredMessage[]; memories: UserMemory[] }>;

  // export / backup (local only)
  exportAll(): Promise<string>;
  importAll(json: string): Promise<{ imported: number; skipped: number }>;

  close(): Promise<void>;
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
