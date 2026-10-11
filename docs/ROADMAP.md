# RAPHAEL Roadmap

Completion criteria are measurable. Nothing is marked complete until its
criteria pass on this machine. Planned features are never presented as done.

## 1. Presence runtime — DONE (v0.1, this milestone)

- [x] 13 typed presence states, explicit transition table, rejection logging
- [x] Central event processor independent of UI; UI subscribes only
- [x] Original Sigil geometry reflecting actual runtime state
- [x] Simulation runner labelled SIMULATION; invalid/failure/approval paths
- [x] Verification gate (passing checks required) + approval pause/resume
- [x] Timeline + inspector diagnostics
- [x] Tests: init, valid/invalid transitions, event processing, error
      fallback, hypothesis/experiment changes, approval, verification
- [x] typecheck + production build pass
- [ ] Follow-ups (not yet): system-tray presence, transparent always-on-top
      compact mode, app icons + bundle signing, speech-activity link for the
      `speaking` state (currently triggerable, not wired to real audio)

## 2. Persistent memory and task continuity

- `MemoryStore` file-backed adapter (local JSON/SQLite, no cloud).
- Task records survive restart; Sigil restores to a truthful state.
- Criteria: restart mid-task → state, hypotheses, and timeline reloaded.

## 3. Evidence-backed analysis and competing hypotheses

- `ModelProvider` seam with a local-first adapter (small on-device model;
  no auto-downloads, modest hardware budget).
- Real `analysis.started/completed` from permitted sources; competing
  hypotheses rendered as Sigil branches.
- Criteria: two rival hypotheses with distinct evidence shown; rejection
  visibly removes a branch.

## 4. Controlled local tool execution

- `ToolExecutor` (inspect/propose/executeApproved) + `ApprovalPolicy`.
- Read-only inspection never needs approval; writes always do.
- Criteria: unapproved write is blocked and logged; approved write executes
  and verifies; no model-generated command runs without a policy check.

## 5. Experiment evaluation and verified skills

- `ExperimentRunner` + `SkillRegistry` (propose → validate → promote).
- Successful procedures become versioned skill candidates; promotion needs
  validation pass.
- Criteria: skill promoted only after validation; failed validation blocks
  promotion with a report.

## 6. Environment monitoring and proactive findings

- Permitted-source watchers (explicit user allowlist only), change notices
  ranked by evidence and impact (ORACLE).
- Criteria: source change → finding with evidence links; no unsolicited
  file access; no background surveillance beyond the allowlist.

## 7. Voice interaction and richer perception

- Real speech activity drives `listening`/`speaking`; reduced-motion and
  mic-permission boundaries respected.
- Criteria: utterance visibly moves Sigil listening → thinking; TTS activity
  drives speaking; mic off = states unreachable.

## 8. Capable orchestration and constrained autonomy

- Multi-step tasks across tools with per-step approval policy, full audit
  trail, user-defined autonomy bounds.
- Criteria: autonomous run stays inside bounds; every out-of-bounds step
  pauses for approval; complete replay from the event log.
