/**
 * indexeddb.ts — IndexedDB-backed MemoryStore.
 *
 * Durable, same-origin, transactional. One object store holds the whole
 * versioned document as a single serialized payload, so every operation is a
 * read-modify-write inside a single IDB transaction. No native compilation,
 * no cloud, no background processes, no automatic network upload.
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
  migrate,
  now,
  SCHEMA_VERSION,
  tableNames,
  type RawDb,
  ValidationError,
} from "./schema";

const DB_NAME = "raphael-memory";
const STORE_NAME = "state";
const DB_VERSION = 1;

export class IndexedDBMemoryStore implements MemoryStore {
  readonly driver = "indexeddb";
  readonly version = SCHEMA_VERSION;
  private db: IDBDatabase | null = null;

  async ping(): Promise<void> {
    await this.open();
  }

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onerror = () => {
          // Logical storage error on an open connection; ignore, next open retries.
        };
        resolve(this.db!);
      };
    });
  }

  private async readWrite<R>(work: (db: RawDb) => R): Promise<R> {
    const database = await this.open();
    return new Promise<R>((resolve, reject) => {
      const tx = database.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const get = store.get("db");
      get.onsuccess = () => {
        const raw = (get as { result: unknown }).result as unknown;
        const db: RawDb = raw === undefined ? emptyDb() : migrate(raw).db;
        let result: R;
        try {
          result = work(db);
        } catch (err) {
          reject(err);
          return;
        }
        const tx2 = database.transaction([STORE_NAME], "readwrite");
        const store2 = tx2.objectStore(STORE_NAME);
        const put = store2.put({ key: "db", payload: encodeDb(db) });
        put.onsuccess = () => resolve(result);
        put.onerror = () => reject(put.error ?? new Error("IndexedDB write failed"));
        tx2.onerror = (evt) =>
          reject((evt.target as IDBTransaction).error ?? new Error("IndexedDB transaction failed"));
      };
      get.onerror = () => reject(get.error ?? new Error("IndexedDB read failed"));
      tx.onerror = (evt) =>
        reject((evt.target as IDBTransaction).error ?? new Error("IndexedDB transaction failed"));
    });
  }

  async listConversations(): Promise<Conversation[]> {
    return this.readWrite((db) => Object.values(db.conversations).sort(byUpdatedAt));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return this.readWrite((db) => db.conversations[id]);
  }

  async createConversation(title?: string): Promise<Conversation> {
    return this.readWrite((db) => {
      const nowMs = now();
      const conversation: Conversation = {
        id: generateId("conv"),
        title: title ?? "New conversation",
        createdAt: nowMs,
        updatedAt: nowMs,
      };
      db.conversations[conversation.id] = conversation;
      return conversation;
    });
  }

  async updateConversation(id: string, patch: Partial<Conversation>): Promise<void> {
    await this.readWrite((db) => {
      const existing = db.conversations[id];
      if (!existing) throw new ValidationError(`conversations.${id}`, "not found");
      db.conversations[id] = { ...existing, ...patch, updatedAt: now(), id };
    });
  }

  async deleteConversation(id: string): Promise<void> {
    await this.readWrite((db) => {
      if (!db.conversations[id]) throw new ValidationError(`conversations.${id}`, "not found");
      delete db.conversations[id];
      for (const [msgId, msg] of Object.entries(db.messages)) {
        if (msg.conversationId === id) delete db.messages[msgId];
      }
    });
  }

  async addMessage(message: Omit<StoredMessage, "id">): Promise<StoredMessage> {
    return this.readWrite((db) => {
      if (!db.conversations[message.conversationId]) {
        throw new ValidationError("messages", "unknown conversation");
      }
      const nowMs = now();
      const stored: StoredMessage = {
        id: generateId("msg"),
        ...message,
        createdAt: message.createdAt ?? nowMs,
      };
      db.messages[stored.id] = stored;
      touchConversation(db, stored.conversationId, nowMs);
      return stored;
    });
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    return this.readWrite((db) =>
      Object.values(db.messages)
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    );
  }

  async updateMessage(id: string, patch: { content?: string }): Promise<void> {
    await this.readWrite((db) => {
      const existing = db.messages[id];
      if (!existing) throw new ValidationError(`messages.${id}`, "not found");
      db.messages[id] = { ...existing, ...patch };
    });
  }

  async deleteMessage(id: string): Promise<void> {
    await this.readWrite((db) => {
      if (!db.messages[id]) throw new ValidationError(`messages.${id}`, "not found");
      delete db.messages[id];
    });
  }

  async listUserMemories(): Promise<UserMemory[]> {
    return this.readWrite((db) => Object.values(db.userMemories).sort(byUpdatedAt));
  }

  async addUserMemory(memory: Omit<UserMemory, "id" | "createdAt" | "updatedAt">): Promise<UserMemory> {
    return this.readWrite((db) => {
      const nowMs = now();
      const stored: UserMemory = {
        id: generateId("mem"),
        ...memory,
        createdAt: nowMs,
        updatedAt: nowMs,
      };
      db.userMemories[stored.id] = stored;
      return stored;
    });
  }

  async updateUserMemory(id: string, patch: Partial<UserMemory>): Promise<void> {
    await this.readWrite((db) => {
      const existing = db.userMemories[id];
      if (!existing) throw new ValidationError(`userMemories.${id}`, "not found");
      db.userMemories[id] = { ...existing, ...patch, updatedAt: now(), id };
    });
  }

  async deleteUserMemory(id: string): Promise<void> {
    await this.readWrite((db) => {
      if (!db.userMemories[id]) throw new ValidationError(`userMemories.${id}`, "not found");
      delete db.userMemories[id];
    });
  }

  async listProjects(): Promise<Project[]> {
    return this.readWrite((db) => Object.values(db.projects).sort(byUpdatedAt));
  }

  async createProject(project: Omit<Project, "id">): Promise<Project> {
    return this.readWrite((db) => {
      const nowMs = now();
      const stored: Project = { id: generateId("proj"), ...project, createdAt: nowMs, updatedAt: nowMs };
      db.projects[stored.id] = stored;
      return stored;
    });
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<void> {
    await this.readWrite((db) => {
      const existing = db.projects[id];
      if (!existing) throw new ValidationError(`projects.${id}`, "not found");
      db.projects[id] = { ...existing, ...patch, updatedAt: now(), id };
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.readWrite((db) => {
      if (!db.projects[id]) throw new ValidationError(`projects.${id}`, "not found");
      delete db.projects[id];
    });
  }

  async listGoals(): Promise<Goal[]> {
    return this.readWrite((db) => Object.values(db.goals).sort(byUpdatedAt));
  }

  async createGoal(goal: Omit<Goal, "id">): Promise<Goal> {
    return this.readWrite((db) => {
      const nowMs = now();
      const stored: Goal = { id: generateId("goal"), ...goal, createdAt: nowMs, updatedAt: nowMs };
      db.goals[stored.id] = stored;
      return stored;
    });
  }

  async updateGoal(id: string, patch: Partial<Goal>): Promise<void> {
    await this.readWrite((db) => {
      const existing = db.goals[id];
      if (!existing) throw new ValidationError(`goals.${id}`, "not found");
      db.goals[id] = { ...existing, ...patch, updatedAt: now(), id };
    });
  }

  async deleteGoal(id: string): Promise<void> {
    await this.readWrite((db) => {
      if (!db.goals[id]) throw new ValidationError(`goals.${id}`, "not found");
      delete db.goals[id];
    });
  }

  async listDecisions(): Promise<Decision[]> {
    return this.readWrite((db) => Object.values(db.decisions).sort(byUpdatedAt));
  }

  async createDecision(decision: Omit<Decision, "id">): Promise<Decision> {
    return this.readWrite((db) => {
      const nowMs = now();
      const stored: Decision = { id: generateId("dec"), ...decision, createdAt: nowMs };
      db.decisions[stored.id] = stored;
      return stored;
    });
  }

  async deleteDecision(id: string): Promise<void> {
    await this.readWrite((db) => {
      if (!db.decisions[id]) throw new ValidationError(`decisions.${id}`, "not found");
      delete db.decisions[id];
    });
  }

  async listTaskSessions(): Promise<TaskSession[]> {
    return this.readWrite((db) => Object.values(db.sessions).sort(byUpdatedAt));
  }

  async createTaskSession(session: Omit<TaskSession, "id">): Promise<TaskSession> {
    return this.readWrite((db) => {
      const nowMs = now();
      const stored: TaskSession = { id: generateId("sess"), ...session, startedAt: nowMs };
      db.sessions[stored.id] = stored;
      return stored;
    });
  }

  async closeTaskSession(id: string): Promise<void> {
    await this.readWrite((db) => {
      const existing = db.sessions[id];
      if (!existing) throw new ValidationError(`sessions.${id}`, "not found");
      db.sessions[id] = { ...existing, status: "closed", closedAt: now() };
    });
  }

  async retrieveContext(conversationId: string, options?: {
    maxMessages?: number;
    maxChars?: number;
    includeMemories?: boolean;
  }): Promise<{ messages: StoredMessage[]; memories: UserMemory[] }> {
    const maxMessages = options?.maxMessages ?? 50;
    const maxChars = options?.maxChars ?? 6000;
    return this.readWrite((db) => {
      const messages = Object.values(db.messages)
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
        ? Object.values(db.userMemories).sort(byUpdatedAt).slice(0, 25)
        : [];
      return { messages: selected, memories };
    });
  }

  async exportAll(): Promise<string> {
    return this.readWrite((db) => encodeDb(db));
  }

  async importAll(json: string): Promise<{ imported: number; skipped: number }> {
    const { db } = decodeDb(json); // decodeDb validates + repairs; all kept records are valid
    let imported = 0;
    let skipped = 0;
    await this.readWrite((current) => {
      for (const table of tableNames()) {
        const records = db[table] as Record<string, unknown>;
        for (const [id, record] of Object.entries(records)) {
          if (Object.prototype.hasOwnProperty.call(current[table], id)) {
            skipped += 1;
            continue;
          }
          try {
            current[table][id] = record as never;
            imported += 1;
          } catch {
            skipped += 1;
          }
        }
      }
    });
    return { imported, skipped };
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
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

export function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
