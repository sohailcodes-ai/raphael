# RAPHAEL Architectural Decisions

## ADR-001 — Local-first, no cloud dependency for v0.1

No accounts, paid APIs, analytics, or remote databases. The runtime and UI
run entirely on-device. Rationale: the presence system must be demonstrable
and testable on constrained Windows hardware with zero provisioning, and
permission boundaries are easier to reason about when nothing leaves the
machine. Model inference stays replaceable behind `ModelProvider` so a
compatible local model can be adopted later without re-architecture.

## ADR-002 — Event-driven presence: runtime owns state, UI subscribes

All operational logic lives in `RaphaelRuntime`; components dispatch typed
events and render subscribed state. Rejected alternative: state inside React
components — discarded because it duplicates truth across components, is
untestable without rendering, and lets the UI "infer" success from text.
The processor is pure TypeScript with no DOM dependency, tested by vitest.

## ADR-003 — Explicit transition table over ad-hoc animation switching

`stateMachine.ts` whitelists valid transitions; everything else is rejected
with a reason. Rejected alternative: per-component animation clips —
discarded because unrelated clips drift from real state and can depict
success that never happened. Safety-critical restrictions (no
dormant→executing, verified only from check-capable states) are encoded as
data, reviewed in tests.

## ADR-004 — Original authored SVG geometry for the Sigil

The Sigil is hand-authored polygons/arcs in `Sigil.tsx`; no image assets,
no stock "AI orb". Rationale: recognizability without glow or text,
near-zero load cost, full parametric control per state, and no IP or
licensing exposure. Motion lives in one CSS system keyed by state class.

## ADR-005 — Verification gate inside the processor, not the UI

`verified` requires passing checks in the event payload; the processor
rejects check-less claims and logs a failed `VerificationRecord`. Rationale:
the "never depict unexecuted success" rule must hold even against buggy or
malicious event producers — the UI cannot be trusted to enforce it.

## ADR-006 — Approval as a first-class runtime state

`awaiting_approval` is a presence state, not a modal dialog flag, so paused
work is visible in the Sigil and pausable in the event log. Future
`ToolExecutor.executeApproved` will require the grant token recorded here.

## ADR-007 — Testability without the desktop shell

`src/runtime` imports nothing from React, Tauri, or the DOM, so the full
operating cycle runs under vitest. The Tauri shell (`src-tauri/`) contains
zero business logic and is swappable without touching the runtime.

## ADR-008 — Seams now, implementations later

`boundaries.ts` defines only interfaces the current milestone (or its
immediate next step) benefits from. No mock services, no speculative layers.
Each future adapter must arrive with the milestone that exercises it.

## ADR-009 — Tauri + React + TypeScript + Vite, CSS/SVG motion

Tauri (Rust present: 1.98.1) for a small native footprint and frameless
presence window; React for component structure; strict TypeScript for the
event/state contracts; Vite for builds; CSS/SVG animation (no motion
library) to keep the dependency footprint minimal and animations
interruptible and reduced-motion aware.
