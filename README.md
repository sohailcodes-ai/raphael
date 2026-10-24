# RAPHAEL — Adaptive Intelligence Runtime + Original Animated Presence

RAPHAEL is a long-term personal intelligence system built as a persistent,
adaptive runtime with a recognizable animated presence — not a chatbot skin,
landing page, or metrics dashboard.

The defining visible feature is the **Sigil**: a small, original animated
entity (authored SVG geometry, no stock assets) whose appearance is driven by
a typed runtime state machine. The Sigil never performs; it reflects. Every
visible state corresponds to actual runtime state, and the UI subscribes to
the runtime — it never owns the logic.

> Long-term inspiration: the operational intelligence and recognizable
> presence of Raphael/Ciel-type fictional intelligences. No character designs,
> artwork, dialogue, or IP are copied. Identity and geometry here are original.

## Current status: Presence Runtime v0.2 (intelligence core)

Implemented and verified:

- Original Sigil (custom SVG crystalline geometry) with 13 typed presence
  states, one coherent motion system, `prefers-reduced-motion` support.
- Event-driven runtime: typed `RuntimeEvent`s, explicit transition table,
  central `RaphaelRuntime` processor with hypothesis / experiment /
  approval / verification bookkeeping.
- Verification gate: `verified` requires passing checks — untested claims
  are rejected, never displayed as success.
- Approval gate: `awaiting_approval` pauses work until grant/deny.
- Development scenario runner, explicitly labelled SIMULATION, exercising
  valid transitions, invalid transitions, failures, approvals, uncertainty,
  and verified completion.
- Event timeline + inspector (hypotheses, experiments, verifications,
  approvals, state changes).
- **Real model inference via Ollama**: narrow Tauri command bridge to the
  loopback Ollama instance (`127.0.0.1:11434`, `/api/tags`, `/api/generate`).
  Connection status, model listing, user model selection, bounded prompts,
  timeouts, cancellation, and sanitized user-facing errors. Never pulls or
  downloads a model. No arbitrary remote URL access.
- **Persistent, versioned local memory**: IndexedDB-backed `MemoryStore`
  (same-origin, transactional, no native compilation) with in-memory fallback.
  Conversations, messages, user-approved memories, projects, goals, decisions,
  task sessions, timestamps/provenance, export/import with validation, schema
  migration that drops corrupted records, and durability across restarts.
- **End-to-end intelligence workflow**: user input → conversation context →
  memory retrieval → bounded model context → real inference → persistence →
  runtime events → render. Duplicate submission rejection, cancellation,
  provider outage recovery, and conversation continuity.
- **Conversation UI**: conversation panel, message history, input composer,
  send/cancel, new conversation, model selection, provider status, memory
  inspection and controls, loading/offline/empty/error states.
- 72 automated tests (provider, memory, interaction engine, runtime, state
  machine). Typecheck + production build pass.
- Tauri native shell configured (frameless window, drag region, window
  controls). The Vite frontend runs standalone; `tauri dev/build` needs the
  Tauri prerequisites below.

## Setup

Prerequisites: Node.js 18+, npm. Rust toolchain only needed for the Tauri
desktop shell (blocked on this machine — see below).

```powershell
npm install
npm run dev        # frontend dev server (http://localhost:1420)
npm test           # vitest suite
npm run typecheck  # tsc --noEmit
npm run build      # production frontend build -> dist/
```

Desktop shell (Tauri): native compile is blocked on this machine — no
Visual Studio / MSVC Build Tools and the active Rust toolchain is
`stable-x86_64-pc-windows-gnu` (Tauri on Windows requires MSVC). Until
MSVC Build Tools + `rustup toolchain install stable-x86_64-pc-windows-msvc`
are installed, the app runs fully as a web frontend (IndexedDB memory works,
Ollama bridge requires the Tauri shell).

```powershell
npm run tauri dev    # blocked: needs MSVC Build Tools
```

Ollama (for real model inference): install Ollama separately from
https://ollama.com, start it, pull a model manually (RAPHAEL never pulls
models itself), then launch RAPHAEL and select the installed model from the
provider status control.

Keyboard: `I` toggles inspector, `R` resets the runtime.

## Architecture (short version)

```
UI components (Sigil, ConversationPanel, Timeline, ScenarioPanel, Inspector)
        │ subscribe / dispatch events
RaphaelRuntime.process(event)  ── validates, bookkeeps, transitions
        │                ├── stateMachine.ts (explicit transition table)
        │                └── EVENT_TARGET_STATE (event → requested state)
MemoryStore (IndexedDB / in-memory)  ← durable local memory
ModelProvider → OllamaProvider → Tauri bridge → local Ollama (127.0.0.1:11434)
InteractionEngine  ← wires provider + memory + runtime into real turns
Future seams: boundaries.ts (ToolExecutor, SkillRegistry,
  ExperimentRunner, ApprovalPolicy, EventPublisher)
```

See `docs/ARCHITECTURE.md` (what exists vs planned), `docs/ROADMAP.md`
(milestones with measurable criteria), `docs/DECISIONS.md` (ADRs).

## Truthfulness contract

- Simulated scenario events carry `simulated: true` and are badged SIMULATION.
- Hypotheses are graded `hypothesis`, never `fact`.
- `verified` requires at least one passing check in the event payload.
- The UI never infers success from text; only from runtime state.
- Model output is persisted as an assistant message, never as fact.
- User-approved memories are kept distinct from model suggestions.
- The model is never the authority on whether an operation succeeded.

## Limitations (v0.2)

- No tool execution, voice, autonomous investigations, or environment
  monitoring. The `ToolExecutor` boundary exists but is unimplemented (next
  milestone). No model-generated command may execute.
- Ollama connection requires the Tauri desktop shell; standalone web frontend
  cannot reach Ollama directly (webview security boundary).
- Native Tauri compile blocked on this machine (no MSVC Build Tools).
- Memory uses IndexedDB (durable) with an in-memory fallback when IndexedDB
  is unavailable; the active driver is shown in the UI.
- The Oracle, evolving validated skills, voice, and controlled tool execution
  remain separate future capabilities.
