# RAPHAEL Architecture — Presence Runtime v0.1

## Application boundary

```
┌─────────────────────────────────────────────────┐
│ Tauri shell (src-tauri/)                        │  native window only;
│  frameless window, drag region, min/close       │  no business logic
├─────────────────────────────────────────────────┤
│ Frontend (src/)                                 │
│  components/  Sigil, Timeline, ScenarioPanel,  │  render subscribed state;
│               Inspector, App                    │  dispatch events only
│  hooks/       useRuntime (singleton binding)    │
│  runtime/     events, presenceStates,           │  owns ALL logic;
│               stateMachine, processor,          │  UI-independent, tested
│               scenarios, boundaries             │  without launching the app
└─────────────────────────────────────────────────┘
```

Data flows one way: UI dispatches `RuntimeEvent` → `RaphaelRuntime.process`
validates → updates registries → attempts `tryTransition` → emits to
subscribers → UI re-renders. The UI never writes state directly.

## The Sigil and presence-state system

- `presenceStates.ts`: the 13-state union + human metadata. Single source
  of truth for state names.
- `Sigil.tsx`: original authored SVG — asymmetric central shard, three
  satellite shards, two orbital arcs, one accent node, optional hypothesis
  branch lines. Props: `state` (+ branch count). No animation is chosen by
  the UI; CSS classes `sigil--<state>` encode arrangement + motion quality.
- `stateMachine.ts`: explicit transition table (`TRANSITIONS`), `can` /
  `try` / `validTargets`. Self-transitions are no-ops. Rejections return
  reasons; nothing throws.
- Key safety rules: `executing` unreachable straight from `dormant`;
  `verified` reachable only from `experimenting` / `executing` / `speaking`;
  `awaiting_approval` pauses experiment/hypothesis/execute work.
- `styles.css` holds the one coherent motion system; `prefers-reduced-motion`
  collapses it to static per-state arrangements.

## Event contracts and transitions

`RuntimeEvent = { id, type, timestamp, source, taskId?, correlationId?,
simulated, payload? }`. `EVENT_TARGET_STATE` maps each type to its requested
presence state. The processor additionally enforces:

- **Verification gate** (`verified`): payload must contain ≥1 passing check,
  else the event is rejected and a failed `VerificationRecord` is logged.
- **Approval bookkeeping**: `approval.requested` opens a pending
  `ApprovalRequest`; `granted`/`denied` resolve it.
- **Knowledge grades**: hypotheses recorded as `hypothesis` (competing,
  `proposed` → `supported`/`rejected`); experiments as
  `running` → `passed`/`failed` with per-check results. Nothing is promoted
  to fact without verification.

## Runtime ↔ UI relationship

Singleton `RaphaelRuntime` in `hooks/useRuntime.ts`; `usePresence()`
subscribes. `Timeline` renders the event log + rejections verbatim.
`Inspector` renders hypothesis / experiment / approval / verification
stores. `ScenarioPanel` dispatches — including deliberately invalid events
to demonstrate rejection.

## Planned interfaces (exist as seams, no implementations yet)

| Interface | Future milestone | Responsibility |
|---|---|---|
| `ModelProvider` | 3, 8 | replaceable local-first inference |
| `MemoryStore` | 2 | projects/goals/decisions/history |
| `ToolExecutor` | 4 | inspect → propose → executeApproved |
| `SkillRegistry` | 5 | propose → validate → promote |
| `ExperimentRunner` | 5 | run defined checks |
| `ApprovalPolicy` | 4 | requiresApproval / requestApproval |
| `EventPublisher` | 6 | external observers |

See `src/runtime/boundaries.ts`. Adapters are built only with the milestone
that needs them — no placeholder services.

## Verification and skill-validation boundaries [PLANNED]

`VerificationRecord` (exists) will feed skill promotion: only procedures
whose experiments pass defined checks become `SkillRegistry` candidates,
and promotion requires an explicit `validate` pass. No self-promotion.

## Error handling and permission boundaries

- Processor never throws on bad input: malformed events and invalid
  transitions are logged to the rejection log and surfaced in the timeline.
- Subscriber exceptions are isolated; the runtime continues.
- v0.1 performs **no** tool execution, no filesystem access beyond the app,
  no network calls, no telemetry, no autostart. The future `ToolExecutor`
  keeps `inspect` (read-only) / `propose` / `executeApproved` distinct, and
  execution will require an `ApprovalPolicy` grant — no model-generated
  command runs unchecked.

## Diagram

```
OBSERVE(input.received→listening) → MODEL(processing/thinking)
 → HYPOTHESIZE(hypotheses.proposed→hypothesizing, branches visible)
 → EXPERIMENT(experiment.started→experimenting; failed→error removes path)
 → EVALUATE(experiment.completed→thinking; uncertain if evidence is thin)
 → ACT(approval.requested→awaiting_approval; granted→executing)
 → VERIFY(verified + passing checks → verified state)
 → LEARN(records persist in runtime stores → future MemoryStore/Skills)
```

## Exists today vs planned

EXISTS: presence states, transition table, event processor, gates,
hypothesis/experiment/approval/verification stores, Sigil, timeline,
inspector, simulation scenarios, tests.
PLANNED: everything in ROADMAP milestones 2–8.
