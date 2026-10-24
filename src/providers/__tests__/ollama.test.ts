import { describe, expect, it } from "vitest";
import { OllamaProvider, ProviderError, providerErrorMessage } from "../ollama";
import type { InvokeFn } from "../ollama";

function makeInvoke(handlers: Record<string, (args?: unknown) => Promise<unknown>>): InvokeFn {
  return async (cmd: string, args?: unknown) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`unknown command: ${cmd}`);
    return h(args);
  };
}async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

describe("OllamaProvider — connection and model listing", () => {
  it("reports connected with installed models", async () => {
    const invoke = makeInvoke({
      ollama_status: async () => ({
        connected: true,
        models: [
          { id: "llama3.2", name: "llama3.2", size: 2_000_000_000 },
          { id: "codellama", name: "codellama", size: 3_800_000_000 },
        ],
        error: undefined,
      }),
    });
    const p = new OllamaProvider({ invoke });
    const s = await p.status();
    expect(s.connected).toBe(true);
    expect(s.models.map((m) => m.name)).toEqual(["llama3.2", "codellama"]);
    expect(s.error).toBeUndefined();

    const list = await p.listModels();
    expect(list.map((m) => m.name)).toEqual(["llama3.2", "codellama"]);
  });

  it("reports offline when Ollama is unreachable", async () => {
    const invoke = makeInvoke({
      ollama_status: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      },
    });
    const p = new OllamaProvider({ invoke });
    const s = await p.status();
    expect(s.connected).toBe(false);
    expect(s.models).toEqual([]);
    expect(s.error).toBe("Ollama is not reachable on this machine. Is it running?");
  });

  it("reports malformed Ollama response without leaking internals", async () => {
    const invoke = makeInvoke({
      ollama_status: async () => ({ connected: true, models: "not-an-array" as unknown }),
    });
    const p = new OllamaProvider({ invoke });
    const s = await p.status();
    expect(s.connected).toBe(true);
    expect(s.models).toEqual([]);
  });

  it("graceful when Tauri shell unavailable", async () => {
    const p = new OllamaProvider({ invoke: undefined as unknown as InvokeFn });
    const s = await p.status();
    expect(s.connected).toBe(false);
    expect(s.models).toEqual([]);
  });

  it("selectModel validates the identifier", async () => {
    const p = new OllamaProvider({ invoke: undefined as unknown as InvokeFn });
    expect(() => p.selectModel("llama3.2")).not.toThrow();
    expect(() => p.selectModel("../etc/passwd")).toThrow(ProviderError);
    expect(() => p.selectModel("http://evil/x")).toThrow(ProviderError);
    expect(() => p.selectModel("a".repeat(200))).toThrow(ProviderError);
    expect(() => p.selectModel("")).toThrow(ProviderError);
    expect(() => p.selectModel("mal;rm -rf /")).toThrow(ProviderError);
    expect(() => p.selectModel("model name with space")).toThrow(ProviderError);
  });

  it("never pulls/downloads a model — complete throws if no model selected", async () => {
    const invoke = makeInvoke({
      ollama_status: async () => ({ connected: true, models: [], error: undefined }),
    });
    const p = new OllamaProvider({ invoke });
    await expect(p.complete([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("providerErrorMessage sanitizes internals", () => {
    expect(providerErrorMessage(new Error("connect refused"))).toContain("Ollama is not reachable");
    expect(providerErrorMessage(new Error("stack trace at line 42"))).toBe("Model request failed.");
    expect(providerErrorMessage(new DOMException("aborted", "AbortError"))).toBe("Request cancelled.");
  });
});

describe("OllamaProvider — real inference", () => {
  it("sends a generate request and returns model output", async () => {
    const invoke = makeInvoke({
      ollama_generate: async (args) => {
        const a = args as { model?: string; prompt?: string };
        expect(a.model).toBe("llama3.2");
        expect(typeof a.prompt).toBe("string");
        return { response: "Hello from RAPHAEL" };
      },
    });
    const p = new OllamaProvider({ invoke });
    p.selectModel("llama3.2");
    const reply = await p.complete([{ role: "user", content: "hi" }]);
    expect(reply).toBe("Hello from RAPHAEL");
  });

  it("passes system prompt and bounds tokens", async () => {
    const invoke = makeInvoke({
      ollama_generate: async (args) => {
        const a = args as { system?: string; maxTokens?: number };
        expect(a.system).toBe("system instructions");
        expect(a.maxTokens).toBe(500);
        return { response: "ok" };
      },
    });
    const p = new OllamaProvider({ invoke });
    p.selectModel("llama3.2");
    await p.complete(
      [
        { role: "system", content: "system instructions" },
        { role: "user", content: "hi" },
      ],
      { maxTokens: 500 },
    );
  });

  it("reports model-not-installed as a user-safe message", async () => {
    const invoke = makeInvoke({
      ollama_generate: async () => {
        throw new Error("Model 'nope' not found.");
      },
    });
    const p = new OllamaProvider({ invoke });
    p.selectModel("nope");
    await expect(p.complete([{ role: "user", content: "hi" }])).rejects.toThrow(
      /not installed/,
    );
  });

  it("reports connection failure without leaking internals", async () => {
    const invoke = makeInvoke({
      ollama_generate: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    const p = new OllamaProvider({ invoke });
    p.selectModel("llama3.2");
    await expect(p.complete([{ role: "user", content: "hi" }])).rejects.toThrow(
      /Ollama is not reachable/,
    );
  });

  it("treats malformed response as failure", async () => {
    const invoke = makeInvoke({
      ollama_generate: async () => ({ nope: true }),
    });
    const p = new OllamaProvider({ invoke });
    p.selectModel("llama3.2");
    await expect(p.complete([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});

describe("OllamaProvider — timeouts and cancellation", () => {
  it("cancels an in-flight request", async () => {
    const invoke = makeInvoke({
      ollama_generate: async () => {
        return new Promise(() => {});
      },
    });
    const p = new OllamaProvider({ invoke });
    p.selectModel("llama3.2");
    const controller = new AbortController();
    const promise = p.complete([{ role: "user", content: "hi" }], {
      signal: controller.signal,
    });
    await sleep(10);
    controller.abort();
    await expect(promise).rejects.toThrow(/aborted|cancelled/i);
  });

  it("abort() causes subsequent complete to reject as aborted", async () => {
    const invoke = makeInvoke({
      ollama_generate: async () => ({ response: "ok" }),
    });
    const p = new OllamaProvider({ invoke });
    p.selectModel("llama3.2");
    p.abort();
    await expect(p.complete([{ role: "user", content: "hi" }])).rejects.toMatchObject(
      { name: "AbortError" },
    );
    const thrown = await p.complete([{ role: "user", content: "hi" }]).then(
      () => null,
      (e) => e,
    );
    expect(errMessage(thrown)).toMatch(/aborted|cancelled/i);
  });

  it("provider respects external AbortSignal", async () => {
    const invoke = makeInvoke({
      ollama_generate: async () => {
        return new Promise(() => {});
      },
    });
    const p = new OllamaProvider({ invoke });
    p.selectModel("llama3.2");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const promise = p.complete([{ role: "user", content: "hi" }], {
      signal: controller.signal,
    });
    await expect(promise).rejects.toThrow(/aborted|cancelled/i);
  });
});
