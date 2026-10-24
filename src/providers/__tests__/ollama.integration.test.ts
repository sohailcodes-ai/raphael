/**
 * ollama.integration.test.ts — Real-Ollama integration path.
 *
 * This suite is skipped in normal CI unless a local Ollama instance is
 * reachable at 127.0.0.1:11434 and RAPHAEL_REAL_OLLAMA is set to "1". It
 * verifies the bridge path end-to-end against a real (already-installed)
 * model. It NEVER pulls or downloads a model.
 */

import { describe, expect, it } from "vitest";
import { OllamaProvider, ProviderError } from "../ollama";
import type { InvokeFn } from "../ollama";

const g = globalThis as Record<string, unknown>;
const proc = g.process as { env?: Record<string, string> } | undefined;
const REAL_OLLAMA = proc?.env?.RAPHAEL_REAL_OLLAMA === "1";

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const realInvoke: InvokeFn = async (cmd: string, args?: unknown): Promise<unknown> => {
  if (cmd === "ollama_status") {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    return {
      connected: res.ok,
      models: (json.models ?? []).map((m: any) => ({ id: m.name, name: m.name, size: m.size, digest: m.digest })),
      error: res.ok ? undefined : String(res.status),
    };
  }
  if (cmd === "ollama_generate") {
    const res = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(args as Record<string, unknown>), stream: false }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return { response: json.response ?? "" };
  }
  throw new Error(`unknown command: ${cmd}`);
};

describe("OllamaProvider — real Ollama integration (gated)", () => {
  it("connects to a real local Ollama and lists installed models", async () => {
    if (!REAL_OLLAMA || !(await reachable())) return;
    const p = new OllamaProvider({ invoke: realInvoke });
    const s = await p.status();
    expect(typeof s.connected).toBe("boolean");
    expect(Array.isArray(s.models)).toBe(true);
    for (const m of s.models) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.name).toBe("string");
    }
  });

  it("sends one bounded generate request if a model is installed", async () => {
    if (!REAL_OLLAMA || !(await reachable())) return;
    const p = new OllamaProvider({ invoke: realInvoke });
    const s = await p.status();
    if (!s.connected || s.models.length === 0) return;
    p.selectModel(s.models[0].id);
    const reply = await p.complete([{ role: "user", content: "Say exactly: ping" }], { maxTokens: 16 });
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
  });

  it("rejects a missing model without leaking internals", async () => {
    if (!REAL_OLLAMA || !(await reachable())) return;
    const p = new OllamaProvider({ invoke: realInvoke });
    p.selectModel("__raphael_definitely_not_installed__");
    await expect(p.complete([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(ProviderError);
  });
});
