/**
 * inmemory.ts — In-memory MemoryStore.
 *
 * Deterministic, async-interface twin of IndexedDBMemoryStore. Used by tests
 * and as the runtime fallback when IndexedDB is unavailable. Data does not
 * survive restart — that limitation is visible via `driver`.
 */

import type {
  Conversation,
  Decision,
  Goal,
  MemoryStore,
  Project,
  StoredMessage,
  TaskSession,
  UserMemory,
} from "../runtime/boundaries";
import {
  decodeDb,
  emptyDb,
  encodeDb,
  generateId,
  now,
  SCHEMA_VERSION,
  tableNames,
  type RawDb,
  ValidationError,
} from "./schema";

export class InMemoryMemoryStore implements MemoryStore {
  readonly driver = "memory";
  readonly version = SCHEMA_VERSION;
  private db: RawDb = emptyDb();

  async ping(): Promise<void> {
    return;
  }

  async listConversations(): Promise<Conversation[]> {
    return Promise.resolve(Object.values(this.db.conversations).sort(byUpdatedAt));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return Promise.resolve(this.db.conversations[id]);
  }

  async createConversation(title?: string): Promise<Conversation> {
    const nowMs = now();
    const conversation: Conversation = {
      id: generateId("conv"),
      title: title ?? "New conversation",
      createdAt: nowMs,
      updatedAt: nowMs,
    };
    this.db.conversations[conversation.id] = conversation;
    return Promise.resolve(conversation);
  }

  async updateConversation(id: string, patch: Partial<Conversation>): Promise<void> {
    const existing = this.db.conversations[id];
    if (!existing) throw new ValidationError(`conversations.${id}`, "not found");
    this.db.conversations[id] = { ...existing, ...patch, updatedAt: now(), id };
    return;
  }

  async deleteConversation(id: string): Promise<void> {
    if (!this.db.conversations[id]) throw new ValidationError(`conversations.${id}`, "not found");
    delete this.db.conversations[id];
    for (const [msgId, msg] of Object.entries(this.db.messages)) {
      if (msg.conversationId === id) delete this.db.messages[msgId];
    }
    return;
  }

  async addMessage(message: Omit<StoredMessage, "id">): Promise<StoredMessage> {
    if (!this.db.conversations[message.conversationId]) {
      throw new ValidationError("messages", "unknown conversation");
    }
    const nowMs = now();
    const stored: StoredMessage = {
      id: generateId("msg"),
      ...message,
      createdAt: message.createdAt ?? nowMs,
    };
    this.db.messages[stored.id] = stored;
    touchConversation(this.db, stored.conversationId, nowMs);
    return Promise.resolve(stored);
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    return Promise.resolve(
      Object.values(this.db.messages)
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    );
  }

  async updateMessage(id: string, patch: { content?: string }): Promise<void> {
    const existing = this.db.messages[id];
    if (!existing) throw new ValidationError(`messages.${id}`, "not found");
    this.db.messages[id] = { ...existing, ...patch };
    return;
  }

  async deleteMessage(id: string): Promise<void> {
    if (!this.db.messages[id]) throw new ValidationError(`messages.${id}`, "not found");
    delete this.db.messages[id];
    return;
  }

  async listUserMemories(): Promise<UserMemory[]> {
    return Promise.resolve(Object.values(this.db.userMemories).sort(byUpdatedAt));
  }

  async addUserMemory(memory: Omit<UserMemory, "id" | "createdAt" | "updatedAt">): Promise<UserMemory> {
    const nowMs = now();
    const stored: UserMemory = {
      id: generateId("mem"),
      ...memory,
      createdAt: nowMs,
      updatedAt: nowMs,
    };
    this.db.userMemories[stored.id] = stored;
    return Promise.resolve(stored);
  }

  async updateUserMemory(id: string, patch: Partial<UserMemory>): Promise<void> {
    const existing = this.db.userMemories[id];
    if (!existing) throw new ValidationError(`userMemories.${id}`, "not found");
    this.db.userMemories[id] = { ...existing, ...patch, updatedAt: now(), id };
    return;
  }

  async deleteUserMemory(id: string): Promise<void> {
    if (!this.db.userMemories[id]) throw new ValidationError(`userMemories.${id}`, "not found");
    delete this.db.userMemories[id];
    return;
  }

  async listProjects(): Promise<Project[]> {
    return Promise.resolve(Object.values(this.db.projects).sort(byUpdatedAt));
  }

  async createProject(project: Omit<Project, "id">): Promise<Project> {
    const nowMs = now();
    const stored: Project = { id: generateId("proj"), ...project, createdAt: nowMs, updatedAt: nowMs };
    this.db.projects[stored.id] = stored;
    return Promise.resolve(stored);
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<void> {
    const existing = this.db.projects[id];
    if (!existing) throw new ValidationError(`projects.${id}`, "not found");
    this.db.projects[id] = { ...existing, ...patch, updatedAt: now(), id };
    return;
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.db.projects[id]) throw new ValidationError(`projects.${id}`, "not found");
    delete this.db.projects[id];
    return;
  }

  async listGoals(): Promise<Goal[]> {
    return Promise.resolve(Object.values(this.db.goals).sort(byUpdatedAt));
  }

  async createGoal(goal: Omit<Goal, "id">): Promise<Goal> {
    const nowMs = now();
    const stored: Goal = { id: generateId("goal"), ...goal, createdAt: nowMs, updatedAt: nowMs };
    this.db.goals[stored.id] = stored;
    return Promise.resolve(stored);
  }

  async updateGoal(id: string, patch: Partial<Goal>): Promise<void> {
    const existing = this.db.goals[id];
    if (!existing) throw new ValidationError(`goals.${id}`, "not found");
    this.db.goals[id] = { ...existing, ...patch, updatedAt: now(), id };
    return;
  }

  async deleteGoal(id: string): Promise<void> {
    if (!this.db.goals[id]) throw new ValidationError(`goals.${id}`, "not found");
    delete this.db.goals[id];
    return;
  }

  async listDecisions(): Promise<Decision[]> {
    return Promise.resolve(Object.values(this.db.decisions).sort(byUpdatedAt));
  }

  async createDecision(decision: Omit<Decision, "id">): Promise<Decision> {
    const nowMs = now();
    const stored: Decision = { id: generateId("dec"), ...decision, createdAt: nowMs };
    this.db.decisions[stored.id] = stored;
    return Promise.resolve(stored);
  }

  async deleteDecision(id: string): Promise<void> {
    if (!this.db.decisions[id]) throw new ValidationError(`decisions.${id}`, "not found");
    delete this.db.decisions[id];
    return;
  }

  async listTaskSessions(): Promise<TaskSession[]> {
    return Promise.resolve(Object.values(this.db.sessions).sort(byUpdatedAt));
  }

  async createTaskSession(session: Omit<TaskSession, "id">): Promise<TaskSession> {
    const nowMs = now();
    const stored: TaskSession = { id: generateId("sess"), ...session, status: "open", startedAt: nowMs };
    this.db.sessions[stored.id] = stored;
    return Promise.resolve(stored);
  }

  async closeTaskSession(id: string): Promise<void> {
    const existing = this.db.sessions[id];
    if (!existing) throw new ValidationError(`sessions.${id}`, "not found");
    this.db.sessions[id] = { ...existing, status: "closed", closedAt: now() };
    return;
  }

  async retrieveContext(conversationId: string, options?: {
    maxMessages?: number;
    maxChars?: number;
    includeMemories?: boolean;
  }): Promise<{ messages: StoredMessage[]; memories: UserMemory[] }> {
    const maxMessages = options?.maxMessages ?? 50;
    const maxChars = options?.maxChars ?? 6000;
    const messages = Object.values(this.db.messages)
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

    let selected: StoredMessage[] = [];
    let chars = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const add = m.content.length;
      if (selected.length >= maxMessages || (chars + add > maxChars && selected.length > 0)) break;
      selected.unshift(m);
      chars += add;
    }

    const memories = options?.includeMemories !== false
      ? Object.values(this.db.userMemories).sort(byUpdatedAt).slice(0, 25)
      : [];
    return Promise.resolve({ messages: selected, memories });
  }

  async exportAll(): Promise<string> {
    return Promise.resolve(encodeDb(this.db));
  }

  async importAll(json: string): Promise<{ imported: number; skipped: number }> {
    const { db } = decodeDb(json);
    let imported = 0;
    let skipped = 0;
    const current: Record<string, Record<string, unknown>> = {
      conversations: this.db.conversations as unknown as Record<string, unknown>,
      messages: this.db.messages as unknown as Record<string, unknown>,
      userMemories: this.db.userMemories as unknown as Record<string, unknown>,
      projects: this.db.projects as unknown as Record<string, unknown>,
      goals: this.db.goals as unknown as Record<string, unknown>,
      decisions: this.db.decisions as unknown as Record<string, unknown>,
      sessions: this.db.sessions as unknown as Record<string, unknown>,
    };
    for (const table of tableNames()) {
      const records = db[table] as Record<string, unknown>;
      const bucket = current[table];
      for (const [id, record] of Object.entries(records)) {
        if (Object.prototype.hasOwnProperty.call(bucket, id)) {
          skipped += 1;
          continue;
        }
        try {
          bucket[id] = record;
          imported += 1;
        } catch {
          skipped += 1;
        }
      }
    }
    return Promise.resolve({ imported, skipped });
  }

  async close(): Promise<void> {
    this.db = emptyDb();
    return;
  }

  /** Test-only: replace the whole document (simulates a restart reload). */
  __replaceDb(db: RawDb): void {
    this.db = db;
  }

  /** Test-only: expose raw document. */
  __rawDb(): RawDb {
    return this.db;
  }
}

function stampOf(rec: { updatedAt?: number; createdAt?: number; startedAt?: number }): number {
  return (rec.updatedAt ?? rec.createdAt ?? rec.startedAt ?? 0);
}

function byUpdatedAt<T extends { id: string }>(a: T, b: T): number {
  return stampOf(b as any) - stampOf(a as any) || a.id.localeCompare(b.id);
}

function touchConversation(db: RawDb, id: string, updatedAt: number): void {
  const existing = db.conversations[id];
  if (existing) db.conversations[id] = { ...existing, updatedAt };
}
