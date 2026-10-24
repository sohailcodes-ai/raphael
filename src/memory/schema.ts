/**
 * schema.ts — Versioned, pure memory schema logic.
 *
 * No I/O, no DOM: pure functions over a plain old object document. The
 * IndexedDB and in-memory adapters both serialize to this shape, so
 * migration, validation, export, and import are testable without a browser.
 */

import type {
  Conversation,
  Decision,
  Goal,
  MemoryKind,
  Project,
  StoredMessage,
  TaskSession,
  UserMemory,
} from "../runtime/boundaries";

export const SCHEMA_VERSION = 1;

export type MemoryTable =
  | "conversations"
  | "messages"
  | "userMemories"
  | "projects"
  | "goals"
  | "decisions"
  | "sessions";

export interface RawDb {
  version: number;
  conversations: Record<string, Conversation>;
  messages: Record<string, StoredMessage>;
  userMemories: Record<string, UserMemory>;
  projects: Record<string, Project>;
  goals: Record<string, Goal>;
  decisions: Record<string, Decision>;
  sessions: Record<string, TaskSession>;
}

export class ValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`memory validation (${path}): ${message}`);
    this.name = "ValidationError";
  }
}

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteTs(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function requiredStr(v: unknown, path: string, field: string): string {
  if (!isStr(v)) throw new ValidationError(path, `${field} must be a non-empty string`);
  return v;
}

function requiredTs(v: unknown, path: string, field: string): number {
  if (!isFiniteTs(v)) throw new ValidationError(path, `${field} must be a valid timestamp`);
  return v;
}

function optionalStr(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : requiredStr(v, "optional", "value");
}

export function validateConversation(v: unknown, path = "conversation"): Conversation {
  const r = v as Record<string, unknown>;
  return {
    id: requiredStr(r.id, path, "id"),
    title: requiredStr(r.title, path, "title"),
    createdAt: requiredTs(r.createdAt, path, "createdAt"),
    updatedAt: requiredTs(r.updatedAt, path, "updatedAt"),
  };
}

export function validateMessage(v: unknown, path = "message"): StoredMessage {
  const r = v as Record<string, unknown>;
  const role = r.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new ValidationError(path, "role must be user, assistant, or system");
  }
  return {
    id: requiredStr(r.id, path, "id"),
    conversationId: requiredStr(r.conversationId, path, "conversationId"),
    role: role as "user" | "assistant" | "system",
    content: typeof r.content === "string" ? r.content : "",
    createdAt: requiredTs(r.createdAt, path, "createdAt"),
  };
}

export function validateUserMemory(v: unknown, path = "userMemory"): UserMemory {
  const r = v as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== "fact" && kind !== "preference" && kind !== "observation") {
    throw new ValidationError(path, 'kind must be "fact", "preference", or "observation"');
  }
  if (r.source !== "user-approved") {
    throw new ValidationError(path, 'source must be "user-approved"');
  }
  return {
    id: requiredStr(r.id, path, "id"),
    kind: kind as MemoryKind,
    statement: requiredStr(r.statement, path, "statement"),
    source: "user-approved",
    conversationId: optionalStr(r.conversationId),
    createdAt: requiredTs(r.createdAt, path, "createdAt"),
    updatedAt: requiredTs(r.updatedAt, path, "updatedAt"),
  };
}

export function validateProject(v: unknown, path = "project"): Project {
  const r = v as Record<string, unknown>;
  return {
    id: requiredStr(r.id, path, "id"),
    name: requiredStr(r.name, path, "name"),
    note: optionalStr(r.note),
    createdAt: requiredTs(r.createdAt, path, "createdAt"),
    updatedAt: requiredTs(r.updatedAt, path, "updatedAt"),
  };
}

export function validateGoal(v: unknown, path = "goal"): Goal {
  const r = v as Record<string, unknown>;
  const status = r.status;
  if (status !== "open" && status !== "done" && status !== "dropped") {
    throw new ValidationError(path, 'status must be "open", "done", or "dropped"');
  }
  return {
    id: requiredStr(r.id, path, "id"),
    projectId: optionalStr(r.projectId),
    title: requiredStr(r.title, path, "title"),
    status: status as "open" | "done" | "dropped",
    createdAt: requiredTs(r.createdAt, path, "createdAt"),
    updatedAt: requiredTs(r.updatedAt, path, "updatedAt"),
  };
}

export function validateDecision(v: unknown, path = "decision"): Decision {
  const r = v as Record<string, unknown>;
  return {
    id: requiredStr(r.id, path, "id"),
    projectId: optionalStr(r.projectId),
    goalId: optionalStr(r.goalId),
    title: requiredStr(r.title, path, "title"),
    summary: requiredStr(r.summary, path, "summary"),
    createdAt: requiredTs(r.createdAt, path, "createdAt"),
  };
}

export function validateTaskSession(v: unknown, path = "session"): TaskSession {
  const r = v as Record<string, unknown>;
  const status = r.status;
  if (status !== "open" && status !== "closed") {
    throw new ValidationError(path, 'status must be "open" or "closed"');
  }
  return {
    id: requiredStr(r.id, path, "id"),
    conversationId: optionalStr(r.conversationId),
    projectId: optionalStr(r.projectId),
    status: status as "open" | "closed",
    startedAt: requiredTs(r.startedAt, path, "startedAt"),
    closedAt: r.closedAt === undefined || r.closedAt === null ? undefined : requiredTs(r.closedAt, path, "closedAt"),
  };
}

const VALIDATORS: Record<MemoryTable, (v: unknown, path?: string) => unknown> = {
  conversations: validateConversation,
  messages: validateMessage,
  userMemories: validateUserMemory,
  projects: validateProject,
  goals: validateGoal,
  decisions: validateDecision,
  sessions: validateTaskSession,
};

export function emptyDb(): RawDb {
  return {
    version: SCHEMA_VERSION,
    conversations: {},
    messages: {},
    userMemories: {},
    projects: {},
    goals: {},
    decisions: {},
    sessions: {},
  };
}

/** Coerce an unknown value into a valid RawDb, repairing or dropping corruption. */
export function migrate(raw: unknown): { db: RawDb; migrated: boolean } {
  let migrated = false;
  let version = 0;

  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).version === "number"
  ) {
    version = (raw as Record<string, unknown>).version as number;
  }

  if (!Number.isFinite(version) || version < 0) {
    version = 0;
    migrated = true;
  }

  const db = emptyDb();

    if (version >= 1 && raw && typeof raw === "object" && !Array.isArray(raw)) {
      const src = raw as Record<string, unknown>;
      for (const table of Object.keys(VALIDATORS) as MemoryTable[]) {
        const sourceBucket = (src as Partial<Record<MemoryTable, unknown>>)[table];
        if (!sourceBucket || typeof sourceBucket !== "object" || Array.isArray(sourceBucket)) continue;
        const records = sourceBucket as Record<string, unknown>;
        const validate = VALIDATORS[table];
        const destBucket = db[table] as Record<string, unknown>;
        for (const [id, value] of Object.entries(records)) {
          try {
            const fixed = validate(value, `${table}.${id}`);
            destBucket[id] = fixed;
          } catch {
          // Corrupted record: dropped, never silently promoted.
          migrated = true;
        }
      }
    }
    if (typeof src.version === "number" && src.version !== SCHEMA_VERSION) migrated = true;
  } else {
    migrated = true;
  }

  db.version = SCHEMA_VERSION;
  return { db, migrated };
}

export function encodeDb(db: RawDb): string {
  return JSON.stringify(db);
}

export function decodeDb(json: string): { db: RawDb; migrated: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return migrate(emptyDb());
  }
  return migrate(raw);
}

export function tableNames(): MemoryTable[] {
  return ["conversations", "messages", "userMemories", "projects", "goals", "decisions", "sessions"];
}

export function now(): number {
  return Date.now();
}

export function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function estimateChars(text: string): number {
  return text.length;
}

/** Rough char-based token bound for context truncation (~4 chars/token). */
export function charsToTokens(chars: number): number {
  return Math.max(1, Math.floor(chars / 4));
}
