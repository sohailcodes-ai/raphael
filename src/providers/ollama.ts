/**
 * ollama.ts — Ollama ModelProvider adapter.
 *
 * Connects only to the loopback Ollama instance (127.0.0.1:11434) through a
 * narrow Tauri command bridge (src-tauri/src/ollama.rs). The frontend never
 * opens arbitrary URLs: host and paths are hardcoded in Rust, model names are
 * validated before forwarding, and `stream` is always forced off.
 *
 * Never pulls or downloads a model. Reports connection status honestly.
 * All user-facing messages are sanitized — no internals, URLs, or stacks.
 */

import type {
  ModelDescriptor,
  ModelMessage,
  ModelProvider,
  ProviderStatus,
} from "../runtime/boundaries";

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_PROMPT_CHARS = 12000;

type OllamaModel = { id: string; name: string; size?: number; digest?: string };

export class ProviderError extends Error {
  constructor(
    public readonly kind: "connection" | "model" | "timeout" | "abort" | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

function isAbortErr(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function sanitize(err: unknown): string {
  if (isAbortErr(err)) return "Request cancelled.";
  if (err instanceof ProviderError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("connect") || lower.includes("unreachable") || lower.includes("refused")) {
    return "Ollama is not reachable on this machine. Is it running?";
  }
  if (lower.includes("not found") || lower.includes("not installed")) {
    return "The requested model is not installed.";
  }
  if (lower.includes("timeout") || lower.includes("deadline")) {
    return "The model request timed out.";
  }
  return "Model request failed.";
}

/** Lazy Tauri invoke. Null outside a Tauri shell (standalone dev/preview). */
export type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

const tauriInvoke = (() => {
  let cached: Promise<InvokeFn | null> | null = null;
  return async (): Promise<InvokeFn | null> => {
    if (cached) return cached;
    cached = (async () => {
      try {
        const mod = await import("@tauri-apps/api/core");
        return mod.invoke as unknown as InvokeFn;
      } catch {
        return null;
      }
    })();
    return cached;
  };
})();

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  private readonly invokeReady: Promise<InvokeFn | null>;
  private selectedId: string | null = null;
  private knownModels: OllamaModel[] = [];
  private aborted = false;

  constructor(options: { invoke?: InvokeFn } = {}) {
    this.invokeReady = options.invoke ? Promise.resolve(options.invoke) : tauriInvoke();
  }

  private async invoke(): Promise<InvokeFn | null> {
    return this.invokeReady;
  }

  async status(): Promise<ProviderStatus> {
    this.aborted = false;
    const invoke = await this.invoke();
    if (!invoke) {
      return {
        connected: false,
        models: [],
        error: "Tauri shell unavailable in this context.",
      };
    }
    try {
      const result = (await invoke("ollama_status")) as {
        connected?: boolean;
        models?: OllamaModel[];
        error?: string;
      };
      this.knownModels = Array.isArray(result.models) ? result.models : [];
      return {
        connected: !!result.connected,
        models: this.knownModels.map((m) => ({
          id: m.id,
          name: m.name,
          size: m.size,
          digest: m.digest,
        })),
        error: result.error ? String(result.error) : undefined,
      };
    } catch (err) {
      this.knownModels = [];
      return { connected: false, models: [], error: sanitize(err) };
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const status = await this.status();
    return status.models;
  }

  selectModel(id: string): void {
    if (!id || typeof id !== "string" || id.length > 128) {
      throw new ProviderError("model", "Invalid model identifier.");
    }
    if (/[\s;`&|<>()*{}[\]]/.test(id) || id.includes("..") || id.includes("://")) {
      throw new ProviderError("model", "Invalid model identifier.");
    }
    this.selectedId = id;
  }

  cancel(): void {
    this.aborted = true;
  }

  /** ModelProvider interface: `abort()` cancels client-side request tracking. */
  abort(): void {
    this.aborted = true;
  }

  async complete(
    messages: ModelMessage[],
    options?: { maxTokens?: number; signal?: AbortSignal },
  ): Promise<string> {
    const model = this.selectedId;
    if (!model) throw new ProviderError("model", "No model selected.");

    const { system, prompt } = renderPrompt(messages);
    if (prompt.length === 0 && !system) {
      throw new ProviderError("unknown", "Nothing to send to the model.");
    }

    const signal = options?.signal;
    let unregister: (() => void) | null = null;
    const externalAbort = new Promise<never>((_resolve: (v: never) => void, reject: (reason?: unknown) => void) => {
      if (signal?.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      const handler = () => {
        this.aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      };
      signal?.addEventListener("abort", handler, { once: true });
      unregister = () => signal?.removeEventListener("abort", handler);
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve: (v: never) => void, reject: (reason?: unknown) => void) => {
      timeoutHandle = setTimeout(
        () => reject(new ProviderError("timeout", "The model request timed out.")),
        DEFAULT_TIMEOUT_MS,
      );
      signal?.addEventListener(
        "abort",
        () => clearTimeout(timeoutHandle ?? undefined),
        { once: true },
      );
    });

    const invoke = await this.invoke();
    if (!invoke) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      throw new ProviderError("connection", "Tauri shell unavailable in this context.");
    }

    const call = async (): Promise<string> => {
      try {
        const result = (await invoke("ollama_generate", {
          model,
          prompt,
          system,
          maxTokens: options?.maxTokens,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })) as { response?: string; error?: string };
        if (this.aborted) throw new DOMException("aborted", "AbortError");
        if (result.error) throw new ProviderError("unknown", String(result.error));
        if (typeof result.response !== "string") {
          throw new ProviderError("unknown", "The model returned an empty response.");
        }
        return result.response;
      } finally {
        if (unregister) unregister();
        this.aborted = false;
      }
    };

    try {
      const value = await Promise.race([call(), externalAbort, timeout]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return value;
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.aborted = true;
      throw mapError(err);
    }
  }
}

function renderPrompt(messages: ModelMessage[]): { system: string; prompt: string } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n").trim();
  const turns = messages.filter((m) => m.role !== "system");
  const prompt = turns
    .map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.content)
    .join("\n\n")
    .trim();
  return { system, prompt: prompt.slice(0, MAX_PROMPT_CHARS) };
}

function mapError(err: unknown): Error {
  if (err instanceof ProviderError || isAbortErr(err)) return err as Error;
  return new ProviderError("unknown", sanitize(err));
}

export function providerErrorMessage(err: unknown): string {
  return sanitize(err);
}
