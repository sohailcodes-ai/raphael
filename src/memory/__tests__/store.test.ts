import { describe, expect, it } from "vitest";
import { InMemoryMemoryStore } from "../inmemory";
import { migrate, decodeDb, emptyDb, ValidationError, generateId } from "../schema";

function freshStore(): InMemoryMemoryStore {
  return new InMemoryMemoryStore();
}

describe("MemoryStore — CRUD (in-memory driver)", () => {
  it("creates and lists conversations", async () => {
    const s = freshStore();
    const c1 = await s.createConversation("Alpha");
    const c2 = await s.createConversation("Beta");
    const list = await s.listConversations();
    expect(list.map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    expect(await s.getConversation(c1.id)).toMatchObject({ title: "Alpha" });
  });

  it("adds and lists messages in conversation order", async () => {
    const s = freshStore();
    const c = await s.createConversation();
    const m1 = await s.addMessage({ conversationId: c.id, role: "user", content: "first", createdAt: 100 });
    const m2 = await s.addMessage({ conversationId: c.id, role: "assistant", content: "second", createdAt: 200 });
    const msgs = await s.listMessages(c.id);
    expect(msgs.map((m) => m.content)).toEqual(["first", "second"]);
    expect(m1.role).toBe("user");
    expect(m2.role).toBe("assistant");
  });

  it("rejects message in unknown conversation", async () => {
    const s = freshStore();
    await expect(
      s.addMessage({ conversationId: "nope", role: "user", content: "x", createdAt: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("updates and deletes messages", async () => {
    const s = freshStore();
    const c = await s.createConversation();
    const m = await s.addMessage({ conversationId: c.id, role: "user", content: "a", createdAt: 1 });
    await s.updateMessage(m.id, { content: "edited" });
    const msgs = await s.listMessages(c.id);
    expect(msgs[0].content).toBe("edited");
    await s.deleteMessage(m.id);
    expect(await s.listMessages(c.id)).toEqual([]);
  });

  it("user-approved memories are CRUD-able and distinct from model output", async () => {
    const s = freshStore();
    const c = await s.createConversation();
    const mem = await s.addUserMemory({
      kind: "fact",
      statement: "User likes concise answers",
      conversationId: c.id,
      source: "user-approved",
    });
    const list = await s.listUserMemories();
    expect(list.map((m) => m.statement)).toContain("User likes concise answers");
    for (const m of list) expect(m.source).toBe("user-approved");
    await s.updateUserMemory(mem.id, { statement: "User likes brief answers" });
    expect((await s.listUserMemories())[0].statement).toBe("User likes brief answers");
    await s.deleteUserMemory(mem.id);
    expect(await s.listUserMemories()).toEqual([]);
  });

  it("projects, goals, decisions, sessions CRUD", async () => {
    const s = freshStore();
    const now = Date.now();
    const p = await s.createProject({ name: "Project A", note: "n", createdAt: now, updatedAt: now });
    const g = await s.createGoal({ projectId: p.id, title: "Goal", status: "open", createdAt: now, updatedAt: now });
    const d = await s.createDecision({ projectId: p.id, goalId: g.id, title: "D", summary: "s", createdAt: now });
    const sess = await s.createTaskSession({ conversationId: "c", projectId: p.id, status: "open", startedAt: now });
    expect((await s.listProjects())[0].name).toBe("Project A");
    expect((await s.listGoals())[0].status).toBe("open");
    expect((await s.listDecisions())[0].title).toBe("D");
    expect((await s.listTaskSessions())[0].status).toBe("open");
    await s.closeTaskSession(sess.id);
    expect((await s.listTaskSessions())[0].status).toBe("closed");
    await s.deleteGoal(g.id);
    await s.deleteDecision(d.id);
    await s.deleteProject(p.id);
    expect(await s.listProjects()).toEqual([]);
    expect(await s.listGoals()).toEqual([]);
    expect(await s.listDecisions()).toEqual([]);
  });

  it("deleteConversation cascades to its messages", async () => {
    const s = freshStore();
    const c = await s.createConversation();
    await s.addMessage({ conversationId: c.id, role: "user", content: "x", createdAt: 1 });
    await s.deleteConversation(c.id);
    expect(await s.getConversation(c.id)).toBeUndefined();
    expect(await s.listMessages(c.id)).toEqual([]);
  });
});

describe("MemoryStore — persistence across restart (simulated)", () => {
  it("in-memory store resets on close (not durable)", async () => {
    const s = freshStore();
    await s.createConversation("survives-close?");
    await s.close();
    const s2 = new InMemoryMemoryStore();
    expect(await s2.listConversations()).toEqual([]);
  });

  it("export then import round-trips valid data", async () => {
    const s = freshStore();
    await s.createConversation("Conv");
    await s.addUserMemory({ kind: "observation", statement: "obs", source: "user-approved" });
    const json = await s.exportAll();
    const s2 = freshStore();
    const res = await s2.importAll(json);
    expect(res.imported).toBeGreaterThan(0);
    const list = await s2.listUserMemories();
    expect(list.map((x) => x.statement)).toContain("obs");
    const convs = await s2.listConversations();
    expect(convs.map((x) => x.title)).toContain("Conv");
  });

  it("import does not duplicate existing records", async () => {
    const s = freshStore();
    await s.createConversation("Conv");
    const json = await s.exportAll();
    const res = await s.importAll(json);
    expect(res.skipped).toBeGreaterThan(0);
  });

  it("import of invalid JSON degrades safely", async () => {
    const s = freshStore();
    const res = await s.importAll("{not json");
    expect(res.imported).toBe(0);
  });
});

describe("Memory — schema migration and corruption", () => {
  it("migrates a version-0 database to current schema", () => {
    const raw = { version: 0, conversations: {}, messages: {}, userMemories: {}, projects: {}, goals: {}, decisions: {}, sessions: {} };
    const { db, migrated } = migrate(raw);
    expect(db.version).toBe(1);
    expect(migrated).toBe(true);
  });

  it("drops corrupted records but keeps valid ones", () => {
    const raw = {
      version: 1,
      conversations: {
        good: { id: "good", title: "T", createdAt: 1, updatedAt: 2 },
        bad: { id: "bad", title: 123, createdAt: 1, updatedAt: 2 },
      },
      messages: {},
      userMemories: {},
      projects: {},
      goals: {},
      decisions: {},
      sessions: {},
    };
    const { db } = migrate(raw);
    expect(db.conversations.good).toBeDefined();
    expect(db.conversations.bad).toBeUndefined();
  });

  it("decodeDb repairs invalid JSON", () => {
    const { db } = decodeDb("garbage");
    expect(db.version).toBe(1);
  });

  it("emptyDb returns versioned shape", () => {
    const db = emptyDb();
    expect(db.version).toBe(1);
    expect(Object.keys(db.conversations)).toEqual([]);
  });

  it("generateId produces stable-prefixed ids", () => {
    const a = generateId("conv");
    const b = generateId("conv");
    expect(a.startsWith("conv-")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("Memory — retrieval and bounded context", () => {
  it("retrieveContext bounds messages by maxMessages and maxChars", async () => {
    const s = freshStore();
    const c = await s.createConversation();
    const long = "x".repeat(200);
    for (let i = 0; i < 10; i++) {
      await s.addMessage({ conversationId: c.id, role: i % 2 === 0 ? "user" : "assistant", content: `msg${i} ${long}`, createdAt: i + 1 });
    }
    const ctx = await s.retrieveContext(c.id, { maxMessages: 3, maxChars: 1000 });
    expect(ctx.messages.length).toBeLessThanOrEqual(3);
  });

  it("retrieveContext includes user-approved memories by default", async () => {
    const s = freshStore();
    const c = await s.createConversation();
    await s.addUserMemory({ kind: "fact", statement: "remember this", source: "user-approved" });
    await s.addMessage({ conversationId: c.id, role: "user", content: "hi", createdAt: 1 });
    const ctx = await s.retrieveContext(c.id);
    expect(ctx.memories.length).toBeGreaterThan(0);
    const noMem = await s.retrieveContext(c.id, { includeMemories: false });
    expect(noMem.memories).toEqual([]);
  });
});

describe("MemoryStore — driver selection", () => {
  it("reports driver and version", async () => {
    const s = freshStore();
    expect(s.driver).toBe("memory");
    expect(s.version).toBe(1);
    await s.ping();
  });
});
