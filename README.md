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

## Current status: Presence Runtime v0.1 (working vertical slice)

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
- 30 automated tests (state machine + processor). Typecheck + production
  build pass.
- Tauri native shell configured (frameless window, drag region, window
  controls). The Vite frontend runs standalone; `tauri dev/build` needs the
  Tauri prerequisites below.

## Setup

Prerequisites: Node.js 18+, npm, Rust toolchain (for the Tauri shell only).

```powershell
npm install
npm run dev        # frontend dev server (http://localhost:1420)
npm test           # vitest suite
npm run typecheck  # tsc --noEmit
npm run build      # production frontend build -> dist/
```

Desktop shell (Tauri): the window config, drag region, and controls are
implemented, but **native compile is blocked on this machine** — `npx tauri
info` reports no Visual Studio / MSVC Build Tools and the active Rust
toolchain is `stable-x86_64-pc-windows-gnu` (Tauri on Windows requires
MSVC). Next step: install VS Build Tools with the C++ workload, then
`rustup toolchain install stable-x86_64-pc-windows-msvc` and
`npm run tauri dev`. Until then, the app runs fully as a web frontend.

```powershell
npm run tauri dev    # blocked: needs MSVC Build Tools (see above)
```

Keyboard: `I` toggles inspector, `R` resets the runtime.

## Architecture (short version)

```
UI components (Sigil, Timeline, ScenarioPanel, Inspector)
        │ subscribe / dispatch events
RaphaelRuntime.process(event)  ── validates, bookkeeps, transitions
        │                ├── stateMachine.ts (explicit transition table)
        │                └── EVENT_TARGET_STATE (event → requested state)
Future seams: boundaries.ts (ModelProvider, MemoryStore, ToolExecutor,
  SkillRegistry, ExperimentRunner, ApprovalPolicy, EventPublisher)
```

See `docs/ARCHITECTURE.md` (what exists vs planned), `docs/ROADMAP.md`
(milestones with measurable criteria), `docs/DECISIONS.md` (ADRs).

## Truthfulness contract

- Simulated scenario events carry `simulated: true` and are badged SIMULATION.
- Hypotheses are graded `hypothesis`, never `fact`.
- `verified` requires at least one passing check in the event payload.
- The UI never infers success from text; only from runtime state.

## Limitations (v0.1)

- No model provider, memory persistence, tool execution, or voice. The
  seams exist as interfaces in `src/runtime/boundaries.ts`; adapters arrive
  with the milestones that need them.
- No system tray / transparent always-on-top floating mode yet — window is
  frameless with standard controls; see ROADMAP milestone 1 follow-ups.
- Scenario runner is simulation only; there is no real analysis yet.
