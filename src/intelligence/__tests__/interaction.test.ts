import { describe, expect, it } from "vitest";
import { InteractionEngine } from "../interaction";
import { RaphaelRuntime } from "../../runtime/processor";
import type {
  ModelProvider,
  ModelMessage,
  ProviderStatus,
  MemoryStore,
  Conversation,
  StoredMessage,
  UserMemory,
} from "../../runtime/boundaries";

class FakeProvider implements ModelProvider {
  readonly name = "fake";
  selected: string | null = null;
  calls: { messages: ModelMessage[]; options?: { maxTokens?: number; signal?: AbortSignal } }[] = [];
  shouldFail = false;
  shouldTimeout = false;
  delayMs = 0;
  abortCalls = 0;
  statusOverride: ProviderStatus = { connected: true, models: [], error: undefined };
  private resolve?: (v: string) => void;
  private reject?: (e: unknown) => void;

  async status(): Promise<ProviderStatus> { return this.statusOverride; }
  async listModels() { return this.statusOverride.models; }
  selectModel(id: string): void { this.selected = id; }
  abort(): void { this.abortCalls += 1; if (this.reject) this.reject(new DOMException("aborted", "AbortError")); }
  async complete(messages: ModelMessage[], options?: { maxTokens?: number; signal?: AbortSignal }): Promise<string> {
    this.calls.push({ messages, options });
    options?.signal?.addEventListener("abort", () => {
      this.reject?.(new DOMException("aborted", "AbortError"));
    }, { once: true });
    if (this.shouldFail) throw new Error("provider exploded");
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      if (this.shouldTimeout) return;
      if (this.delayMs > 0) {
        setTimeout(() => { this.resolve?.("fake reply delayed"); this.resolve = undefined; this.reject = undefined; }, this.delayMs);
      } else {
        this.resolve("fake reply");
        this.resolve = undefined;
        this.reject = undefined;
      }
    }) as Promise<string>;
  }
}

class FakeMemory implements MemoryStore {
  driver = "test-memory";
  version = 1;
  conversations: Record<string, Conversation> = {};
  messages: Record<string, StoredMessage[]> = {};
  memories: UserMemory[] = [];
  sessions: Record<string, { id: string; status: string }> = {};

  async ping() {}
  async listConversations() { return Object.values(this.conversations); }
  async getConversation(id: string) { return this.conversations[id]; }
  async createConversation(title?: string) {
    const id = `conv-${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    const c: Conversation = { id, title: title ?? "New conversation", createdAt: now, updatedAt: now };
    this.conversations[id] = c;
    return c;
  }
  async updateConversation() {}
  async deleteConversation(id: string) { delete this.conversations[id]; this.messages[id] = undefined as unknown as StoredMessage[]; }
  async addMessage(message: Omit<StoredMessage, "id">) {
    if (!this.conversations[message.conversationId]) throw new Error("unknown conversation");
    const id = `msg-${Math.random().toString(36).slice(2)}`;
    const stored: StoredMessage = { id, ...message, createdAt: message.createdAt ?? Date.now() };
    (this.messages[message.conversationId] ??= []).push(stored);
    return stored;
  }
  async listMessages(conversationId: string) { return this.messages[conversationId] ?? []; }
  async updateMessage() {}
  async deleteMessage() {}
  async listUserMemories() { return this.memories; }
  async addUserMemory(memory: Omit<UserMemory, "id" | "createdAt" | "updatedAt">) {
    const now = Date.now();
    const m: UserMemory = { id: `mem-${Math.random().toString(36).slice(2)}`, ...memory, createdAt: now, updatedAt: now, source: "user-approved" };
    this.memories.push(m);
    return m;
  }
  async updateUserMemory() {}
  async deleteUserMemory() {}
  async listProjects() { return []; }
  async createProject() { return { id: "p", name: "x", createdAt: 1, updatedAt: 1 }; }
  async updateProject() {}
  async deleteProject() {}
  async listGoals() { return []; }
  async createGoal() { return { id: "g", title: "x", status: "open" as const, createdAt: 1, updatedAt: 1 }; }
  async updateGoal() {}
  async deleteGoal() {}
  async listDecisions() { return []; }
  async createDecision() { return { id: "d", title: "x", summary: "s", createdAt: 1 }; }
  async deleteDecision() {}
  async listTaskSessions() { return []; }
  async createTaskSession() { return { id: "s", status: "open" as const, startedAt: 1 }; }
  async closeTaskSession(id: string) { if (this.sessions[id]) this.sessions[id].status = "closed"; }
  async retrieveContext() { return { messages: [], memories: this.memories }; }
  async exportAll() { return "{}"; }
  async importAll() { return { imported: 0, skipped: 0 }; }
  async close() {}
}

function makeEngine(opts: { provider?: FakeProvider; memory?: FakeMemory } = {}) {
  const runtime = new RaphaelRuntime();
  const provider = opts.provider ?? new FakeProvider();
  const memory = opts.memory ?? new FakeMemory();
  const engine = new InteractionEngine({ runtime, provider, memory });
  return { engine, runtime, provider, memory };
}

describe("InteractionEngine — real turn flow", () => {
  it("completes a real turn and persists user + assistant messages", async () => {
    const { engine, memory } = makeEngine();
    const outcome = await engine.send("Hello RAPHAEL", { conversationId: undefined });
    if ("error" in outcome) throw new Error(outcome.error);
    if ("cancelled" in outcome) throw new Error("cancelled");
    const msgs = await memory.listMessages(outcome.conversationId);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs.find((m) => m.role === "user")?.content).toBe("Hello RAPHAEL");
    expect(msgs.find((m) => m.role === "assistant")?.content).toBe("fake reply");
  });

  it("selects an existing conversation and continues continuity", async () => {
    const { engine, memory } = makeEngine();
    const first = await engine.send("first message");
    if ("error" in first) throw new Error(first.error);
    const second = await engine.send("second message", { conversationId: first.conversationId });
    if ("error" in second) throw new Error(second.error);
    const msgs = await memory.listMessages(first.conversationId);
    expect(msgs.length).toBe(4);
  });

  it("retrieves memories into model context", async () => {
    const { engine, provider, memory } = makeEngine();
    await memory.addUserMemory({ kind: "fact", statement: "The user prefers brevity", source: "user-approved", conversationId: "c1" });
    await engine.send("hi");
    const lastCall = provider.calls[provider.calls.length - 1];
    const systemContents = lastCall.messages.filter((m) => m.role === "system").map((m) => m.content);
    expect(systemContents.join("\n")).toContain("The user prefers brevity");
  });

  it("keeps model output distinct from user-approved facts (never auto-promotes)", async () => {
    const { engine, memory } = makeEngine();
    await engine.send("Remember that Paris is the capital of France");
    const memories = await memory.listUserMemories();
    expect(memories.length).toBe(0);
  });
});

describe("InteractionEngine — duplicate submission and cancellation", () => {
  it("rejects duplicate submissions while a turn is in flight", async () => {
    const { engine, provider } = makeEngine();
    provider.delayMs = 200;
    const p1 = engine.send("slow");
    await new Promise((r) => setTimeout(r, 20));
    const p2 = engine.send("duplicate");
    const p1res = await p1;
    if ("error" in p1res) throw new Error(p1res.error);
    const p2res = await p2;
    if ("error" in p2res) {
      expect(p2res.recoverable).toBe(true);
    } else {
      throw new Error("duplicate should have been rejected");
    }
  });

  it("cancels an in-flight turn", async () => {
    const { engine, provider } = makeEngine();
    provider.delayMs = 2000;
    const p = engine.send("cancel me");
    await new Promise((r) => setTimeout(r, 50));
    engine.cancel();
    const outcome = await p;
    expect("cancelled" in outcome).toBe(true);
    expect(provider.abortCalls).toBeGreaterThan(0);
  });

  it("allows a new turn after the previous one completes", async () => {
    const { engine } = makeEngine();
    const a = await engine.send("one");
    if ("error" in a) throw new Error(a.error);
    const b = await engine.send("two");
    if ("error" in b) throw new Error(b.error);
  });
});

describe("InteractionEngine — provider failure and recovery", () => {
  it("recovers gracefully from provider failure", async () => {
    const { engine, provider } = makeEngine();
    provider.shouldFail = true;
    const outcome = await engine.send("hi");
    if ("error" in outcome) {
      expect(outcome.recoverable).toBe(true);
      expect(outcome.error).toContain("failed");
    } else {
      throw new Error("expected failure");
    }
    provider.shouldFail = false;
    const ok = await engine.send("hi again");
    if ("error" in ok) throw new Error(ok.error);
    if ("cancelled" in ok) throw new Error("cancelled");
  });

  it("cancellation under a non-responsive provider recovers", async () => {
    const { engine, provider } = makeEngine();
    provider.shouldTimeout = true;
    const p = engine.send("timeout me");
    await new Promise((r) => setTimeout(r, 30));
    engine.cancel();
    const outcome = await p;
    expect("cancelled" in outcome).toBe(true);
  });
});

describe("InteractionEngine — runtime state integration", () => {
  it("emits real runtime events during a turn", async () => {
    const { engine, runtime } = makeEngine();
    const states: string[] = [];
    runtime.subscribe((s) => states.push(s));
    await engine.send("hi");
    expect(states).toContain("listening");
    expect(states).toContain("thinking");
    expect(runtime.getEventLog().length).toBeGreaterThan(0);
    expect(runtime.getRejected().length).toBe(0);
  });
});

describe("InteractionEngine — status and model selection", () => {
  it("reports provider status", async () => {
    const { engine, provider } = makeEngine();
    provider.statusOverride = { connected: true, models: [{ id: "m", name: "m" }], error: undefined, model: "m" };
    const s = await engine.status();
    expect(s.connected).toBe(true);
  });

  it("selects a model", () => {
    const { engine } = makeEngine();
    expect(() => engine.selectModel("m")).not.toThrow();
  });
});

describe("InteractionEngine — empty input", () => {
  it("rejects empty input recoverably", async () => {
    const { engine } = makeEngine();
    const outcome = await engine.send("   ");
    if ("error" in outcome) expect(outcome.recoverable).toBe(true);
    else throw new Error("expected error for empty input");
  });
});
