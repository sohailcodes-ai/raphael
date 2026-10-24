/**
 * interaction.ts — End-to-end intelligence workflow.
 *
 * User input → conversation context → memory retrieval → bounded model
 * context → real inference → persistence → runtime events → render.
 *
 * Truthfulness rules:
 * - Model output is persisted as an assistant message, never as fact.
 * - User-approved memories are kept distinct from model suggestions.
 * - The model is never the authority on whether an operation succeeded.
 * - One turn at a time; duplicate submissions are rejected.
 */

import type {
  MemoryStore,
  ModelMessage,
  ModelProvider,
  ProviderStatus,
  UserMemory,
} from "../runtime/boundaries";
import { createEvent, type EventSource, type RuntimeEventType } from "../runtime/events";
import { RaphaelRuntime } from "../runtime/processor";
import { providerErrorMessage } from "../providers/ollama";

export interface TurnResult {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  reply: string;
}

export interface TurnCancelled {
  conversationId: string;
  cancelled: true;
}

export interface TurnFailure {
  conversationId: string;
  error: string;
  recoverable: boolean;
}

export type TurnOutcome = TurnResult | TurnCancelled | TurnFailure;

export class DuplicateSubmissionError extends Error {
  constructor() {
    super("A message is already being processed. Wait for it to finish, or cancel it.");
    this.name = "DuplicateSubmissionError";
  }
}

const SYSTEM_PROMPT = `You are RAPHAEL, a local-first personal intelligence assistant running on this machine only.
You do not have access to tools, the internet, or this computer beyond this chat.
Be concise, honest, and cautious. If you do not know, say so.
Never claim an action was completed unless the user confirms it in this conversation.
Treat your own outputs as suggestions, not facts; the user decides what is true.`;

/** User-approved memories are injected into the system block, clearly labelled. */
function memoryBlock(memories: UserMemory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m) => `- [${m.kind}] ${m.statement}`).join("\n");
  return `User-approved memory (facts confirmed by the user, not model output):\n${lines}`;
}

export class InteractionEngine {
  private runtime: RaphaelRuntime;
  private provider: ModelProvider;
  private memory: MemoryStore;
  private inflight: { controller: AbortController } | null = null;

  constructor({
    runtime,
    provider,
    memory,
  }: {
    runtime: RaphaelRuntime;
    provider: ModelProvider;
    memory: MemoryStore;
  }) {
    this.runtime = runtime;
    this.provider = provider;
    this.memory = memory;
  }

  async send(
    input: string,
    options: { conversationId?: string; model?: string } = {},
  ): Promise<TurnOutcome> {
    const trimmed = input.trim();
    if (!trimmed) {
      return { conversationId: options.conversationId ?? "", error: "Empty message.", recoverable: true };
    }

    if (this.inflight !== null) {
      return {
        conversationId: options.conversationId ?? "",
        error: "RAPHAEL is already processing a message. Wait for it to finish, or cancel it.",
        recoverable: true,
      };
    }

    let conversationId = options.conversationId;
    if (!conversationId) {
      const conversation = await this.memory.createConversation();
      conversationId = conversation.id;
    } else {
      const exists = await this.memory.getConversation(conversationId);
      if (!exists) {
        return { conversationId, error: "Conversation not found.", recoverable: true };
      }
    }

    if (options.model) {
      this.provider.selectModel(options.model);
    }

    const controller = new AbortController();
    this.inflight = { controller };

    const fail = (message: string, recoverable: boolean): TurnFailure => ({
      conversationId,
      error: message,
      recoverable,
    });

    const dispatch = (type: RuntimeEventType, source: EventSource, payload?: Record<string, unknown>): void => {
      try {
        this.runtime.process(createEvent(type, source, { payload, taskId: conversationId }));
      } catch {
        // The runtime never throws on valid events; guard anyway.
      }
    };

    try {
      // 1. Input received → listening.
      dispatch("input.received", "user", { summary: trimmed });
      const userMessage = await this.memory.addMessage({
        conversationId,
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      });

      // 2. Processing → thinking.
      dispatch("processing.started", "analysis");

      // 3. Retrieve relevant memories → analyzing.
      dispatch("analysis.started", "analysis", { source: "local memory" });
      const { messages: history, memories } = await this.memory.retrieveContext(conversationId, {
        maxMessages: 40,
        maxChars: 6000,
        includeMemories: true,
      });
      dispatch("analysis.completed", "analysis", {
        messages: history.length,
        memories: memories.length,
      });

      // 4. Bounded model context → thinking.
      const modelMessages: ModelMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...(memoryBlock(memories)
          ? [{ role: "system" as const, content: memoryBlock(memories) }]
          : []),
        ...history.map((m): ModelMessage => ({
          role: m.role as ModelMessage["role"],
          content: m.content,
        })),
        { role: "user", content: trimmed },
      ];

      // 5. Real inference (cancellable, timed by the provider).
      const reply = await this.provider.complete(modelMessages, {
        maxTokens: 500,
        signal: controller.signal,
      });

      // 6. Persist the actual interaction.
      const assistantMessage = await this.memory.addMessage({
        conversationId,
        role: "assistant",
        content: reply,
        createdAt: Date.now(),
      });

      // 7. Return to idle; the Sigil reflects only real state.
      dispatch("reset", "system", { note: "turn complete" });

      return {
        conversationId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        reply,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        dispatch("warning.raised", "system", { reason: "turn cancelled by user" });
        dispatch("reset", "system", { note: "turn cancelled" });
        return { conversationId, cancelled: true };
      }
      const message = providerErrorMessage(err);
      dispatch("error.raised", "system", { error: message });
      return fail(message, true);
    } finally {
      this.inflight = null;
    }
  }

  /** Cancel the in-flight turn, if any. */
  cancel(): void {
    if (this.inflight) {
      this.inflight.controller.abort();
      this.provider.abort();
    }
  }

  /** Whether a turn is currently in flight. */
  isProcessing(): boolean {
    return this.inflight !== null;
  }

  /** Current provider connection + model status. */
  async status(): Promise<ProviderStatus> {
    return this.provider.status();
  }

  /** Select the model used for subsequent turns. */
  selectModel(id: string): void {
    this.provider.selectModel(id);
  }
}
