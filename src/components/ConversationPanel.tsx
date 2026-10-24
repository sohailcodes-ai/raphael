/**
 * ConversationPanel.tsx — Real conversation UI for RAPHAEL.
 *
 * Wires the InteractionEngine (ModelProvider + MemoryStore + RaphaelRuntime)
 * into the presence runtime so the Sigil reflects actual turn state. Model
 * output is rendered as assistant output, never as fact. User-approved
 * memories are managed separately.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createMemoryStore } from "../memory/store";
import { OllamaProvider } from "../providers/ollama";
import { InteractionEngine } from "../intelligence/interaction";
import { runtime } from "../hooks/useRuntime";
import type { MemoryKind, ModelProvider } from "../runtime/boundaries";

type Role = "user" | "assistant" | "system";

interface MessageView {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
}

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
}

export function ConversationPanel() {
  const memory = createMemoryStore();
  const isDurable = memory.driver === "indexeddb";
  const provider = useRef<ModelProvider | null>(null);
  const engineRef = useRef<InteractionEngine | null>(null);

  const [conversations, setConversations] = useState<Array<{ id: string; title: string; updatedAt: number }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<{ connected: boolean; model?: string; models: string[]; error?: string }>({
    connected: false,
    model: undefined,
    models: [],
  });
  const [modelsLoading, setModelsLoading] = useState(false);
  const [memories, setMemories] = useState<Array<{ id: string; kind: string; statement: string; createdAt: number }>>([]);
  const [outcome, setOutcome] = useState<{ kind: "error" | "info"; message: string } | null>(null);
  const [memoryEditor, setMemoryEditor] = useState<{ open: boolean; kind: "fact" | "preference" | "observation"; statement: string } | null>(null);

  const engine = useCallback((): InteractionEngine => {
    if (engineRef.current) return engineRef.current;
    const p = provider.current ?? new OllamaProvider();
    provider.current = p;
    const e = new InteractionEngine({ runtime, provider: p, memory });
    engineRef.current = e;
    return e;
  }, [memory]);

  const refreshStatus = useCallback(async () => {
    const e = engine(); // ensures provider exists
    setModelsLoading(true);
    try {
      const s = await e.status();
      setStatus({
        connected: s.connected,
        model: s.model ?? undefined,
        models: s.models.map((m) => m.name),
        error: s.error,
      });
      if (s.connected && s.model && !status.model) {
        e.selectModel(s.model);
      }
    } catch {
      setStatus({ connected: false, models: [], error: "Unable to check provider status." });
    } finally {
      setModelsLoading(false);
    }
  }, [status.model]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const loadConversations = useCallback(async () => {
    const list = await memory.listConversations();
    setConversations(list.slice(0, 50));
  }, [memory]);

  const loadMessages = useCallback(async (id: string) => {
    const msgs = await memory.listMessages(id);
    setMessages(
      msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
    );
    setOutcome(null);
  }, [memory]);

  const loadMemories = useCallback(async () => {
    const list = await memory.listUserMemories();
    setMemories(
      list.map((m) => ({ id: m.id, kind: m.kind, statement: m.statement, createdAt: m.createdAt })),
    );
  }, [memory]);

  useEffect(() => {
    void loadConversations();
    void loadMemories();
  }, [loadConversations, loadMemories]);

  useEffect(() => {
    if (selectedId) void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  const processing = engineRef.current ? engineRef.current.isProcessing() : false;

  const selectConversation = useCallback(async (id: string) => {
    setSelectedId(id);
    setOutcome(null);
  }, []);

  const newConversation = useCallback(async () => {
    if (processing) return;
    const conv = await memory.createConversation();
    setConversations((prev) => [conv, ...prev.slice(0, 49)]);
    setSelectedId(conv.id);
    setMessages([]);
    setOutcome(null);
  }, [memory, processing]);

  const deleteConversation = useCallback(async (id: string) => {
    if (processing) return;
    await memory.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setMessages([]);
    }
  }, [memory, processing, selectedId]);

  const send = useCallback(
    async (text: string) => {
      const e = engine();
      const outcome = await e.send(text, { conversationId: selectedId ?? undefined });
      setOutcome(null);
      if ("cancelled" in outcome) {
        setOutcome({ kind: "info", message: "Turn cancelled." });
        await loadMessages(selectedId ?? "");
        return;
      }
      if ("error" in outcome) {
        setOutcome({ kind: "error", message: outcome.error });
        return;
      }
      await loadMessages(selectedId ?? "");
      setInputValue("");
    },
    [engine, selectedId, processing, loadMessages],
  );

  const cancelTurn = useCallback(() => {
    engine().cancel();
    setOutcome({ kind: "info", message: "Cancelling…" });
  }, [engine]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = inputValue.trim();
      if (!text || processing) return;
      setInputValue("");
      await send(text);
    },
    [inputValue, processing, send],
  );

  const addMemoryFromMessage = useCallback((content: string) => {
    setMemoryEditor({ open: true, kind: "fact", statement: content });
  }, []);

  const saveMemory = useCallback(async () => {
    const editor = memoryEditor;
    if (!editor) return;
    try {
      await memory.addUserMemory({
        kind: editor.kind,
        statement: editor.statement,
        source: "user-approved",
      });
      setMemoryEditor(null);
      await loadMemories();
      setOutcome({ kind: "info", message: "Memory saved." });
    } catch {
      setOutcome({ kind: "error", message: "Could not save memory." });
    }
  }, [memory, memoryEditor, loadMemories]);

  const removeMemory = useCallback(async (id: string) => {
    try {
      await memory.deleteUserMemory(id);
      await loadMemories();
      setOutcome({ kind: "info", message: "Memory deleted." });
    } catch {
      setOutcome({ kind: "error", message: "Could not delete memory." });
    }
  }, [memory, loadMemories]);

  const selectModel = useCallback(async (name: string) => {
    const e = engine();
    e.selectModel(name);
    setStatus((prev) => ({ ...prev, model: name }));
  }, [engine]);

  const refreshModels = useCallback(async () => {
    void refreshStatus();
  }, [refreshStatus]);

  if (selectedId === null) {
    return (
      <div className="conversation-panel">
        <div className="conv-header">
          <div className="conv-title">Conversations</div>
          <ProviderStatus status={status} onRefresh={refreshModels} loading={modelsLoading} />
        </div>
        <div className="conv-list">
          {conversations.length === 0 && (
            <div className="tl-empty">No conversations yet. Start one below.</div>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`conv-item${selectedId === c.id ? " active" : ""}`}
              onClick={() => selectConversation(c.id)}
              title={time(c.updatedAt)}
            >
              <span className="conv-item-title">{c.title}</span>
              <span className="conv-item-time">{time(c.updatedAt)}</span>
              <button className="conv-delete" onClick={(ev) => { ev.stopPropagation(); void deleteConversation(c.id); }} aria-label="Delete conversation">✕</button>
            </button>
          ))}
          <div className="btnrow" style={{ padding: "10px" }}>
            <button className="btn primary" onClick={newConversation} disabled={processing}>
              New conversation
            </button>
          </div>
        </div>
        <div className="conv-empty">
          <p>Select or create a conversation to begin.</p>
          <p className="hint">All messages and approved memories stay on this machine.</p>
        </div>
      </div>
    );
  }

  const current = conversations.find((c) => c.id === selectedId);
  const processingNow = engineRef.current ? engineRef.current.isProcessing() : false;

  return (
    <div className="conversation-panel">
      <div className="conv-header">
        <div className="conv-title">
          {current ? current.title : "Conversation"}
          {!isDurable && <span className="badge badge--memory">memory: session only</span>}
        </div>
        <div className="conv-actions">
          <ProviderStatus status={status} onRefresh={refreshModels} loading={modelsLoading} />
          <ModelSelector models={status.models} current={status.model} onSelect={selectModel} disabled={!status.connected || processingNow} />
          <button className="btn" onClick={newConversation} title="New conversation" disabled={processingNow}>+</button>
          <button className="btn danger" onClick={() => void deleteConversation(selectedId!)} title="Delete conversation" disabled={processingNow}>✕</button>
          {processingNow && (
            <button className="btn" onClick={cancelTurn} title="Cancel">⏹</button>
          )}
        </div>
      </div>

      {outcome && (
        <div className={`alert alert--${outcome.kind}`} role="status" aria-live="polite">
          {outcome.message}
        </div>
      )}

      <div className="conv-scroll" role="log" aria-label="Conversation">
        {messages.length === 0 && (
          <div className="tl-empty">Say something to start the conversation.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`conv-message conv-message--${m.role}`}>
            <div className="conv-message-head">
              <span className="conv-message-role">{m.role === "user" ? "You" : m.role === "assistant" ? "RAPHAEL" : "System"}</span>
              <span className="conv-message-time">{time(m.createdAt)}</span>
            </div>
            <div className="conv-message-body">{m.content}</div>
            {m.role === "assistant" && !processingNow && (
              <div className="conv-message-actions">
                <button className="btn" onClick={() => addMemoryFromMessage(m.content)} title="Save as user-approved memory">Remember</button>
              </div>
            )}
          </div>
        ))}
        {processingNow && (
          <div className="conv-message conv-message--assistant conv-message--pending">
            <div className="conv-message-head"><span className="conv-message-role">RAPHAEL</span></div>
            <div className="conv-message-body">Thinking…</div>
          </div>
        )}
      </div>

      <form className="conv-composer" onSubmit={handleSubmit}>
        <textarea
          className="conv-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Message RAPHAEL…"
          disabled={processingNow}
          rows={2}
          maxLength={4000}
        />
        <div className="conv-composer-actions">
          <button className="btn primary" type="submit" disabled={!inputValue.trim() || processingNow}>
            Send
          </button>
        </div>
      </form>

      <div className="conv-memory">
        <h4>User-approved memory</h4>
        <p className="hint">Explicitly approved facts only — model output is never stored here automatically.</p>
        {memories.length === 0 && <p className="tl-empty">No approved memories yet.</p>}
        {memories.map((m) => (
          <div key={m.id} className="memory-item">
            <span className={`memory-kind memory-kind--${m.kind}`}>{m.kind}</span>
            <div className="memory-statement">{m.statement}</div>
            <div className="memory-actions">
              <button className="btn" onClick={() => setMemoryEditor({ open: true, kind: m.kind as MemoryKind, statement: m.statement }) } title="Edit">Edit</button>
              <button className="btn danger" onClick={() => void removeMemory(m.id)} title="Delete">✕</button>
            </div>
          </div>
        ))}
        <button className="btn" onClick={() => setMemoryEditor({ open: true, kind: "fact", statement: "" })}>Add memory</button>
      </div>

      {memoryEditor && (
        <div className="conv-memory-editor">
          <h4>{memoryEditor.statement ? "Edit memory" : "Add memory"}</h4>
          <label>Kind</label>
          <select value={memoryEditor.kind} onChange={(e) => setMemoryEditor({ ...memoryEditor, kind: e.target.value as MemoryKind })}>
            <option value="fact">Fact</option>
            <option value="preference">Preference</option>
            <option value="observation">Observation</option>
          </select>
          <textarea value={memoryEditor.statement} onChange={(e) => setMemoryEditor({ ...memoryEditor, statement: e.target.value })} rows={3} />
          <div className="btnrow">
            <button className="btn primary" onClick={saveMemory} disabled={!memoryEditor.statement.trim()}>Save</button>
            <button className="btn" onClick={() => setMemoryEditor(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderStatus({
  status,
  onRefresh,
  loading,
}: {
  status: { connected: boolean; model?: string; models: string[]; error?: string };
  onRefresh: () => void;
  loading: boolean;
}) {
  const connected = status.connected;
  const dotClass = `provider-dot provider-dot--${connected ? "ok" : "off"}`;
  const text = connected
    ? `Ollama · ${status.model ?? "no model selected"}${status.error ? ` — ${status.error}` : ""}`
    : `Ollama · offline${status.error ? ` — ${status.error}` : ""}`;
  return (
    <div className="provider-status">
      <span className={dotClass} aria-hidden="true" />
      <span className="provider-text">{text}</span>
      <button className="btn" onClick={onRefresh} disabled={loading} title="Refresh provider status">↻</button>
    </div>
  );
}

function ModelSelector({
  models,
  current,
  onSelect,
  disabled,
}: {
  models: string[];
  current: string | undefined;
  onSelect: (name: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="model-selector">
      <label className="model-label">Model</label>
      <select
        className="model-select"
        value={current ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled || models.length === 0}
      >
        <option value="">— select —</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
