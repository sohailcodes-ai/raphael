/**
 * ScenarioPanel.tsx — Development scenario runner (explicitly SIMULATION).
 * Steps dispatch events one at a time ("Step") or on a timer ("Run all"),
 * so every valid/invalid transition is observable in the Sigil + timeline.
 */

import { useRef, useState } from "react";
import { createEvent } from "../runtime/events";
import { SCENARIOS, nextTaskId } from "../runtime/scenarios";
import { runtime } from "../hooks/useRuntime";

export function ScenarioPanel({ onActivity }: { onActivity: () => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [taskId, setTaskId] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const timer = useRef<number | undefined>(undefined);

  function stopTimer() {
    if (timer.current !== undefined) {
      window.clearInterval(timer.current);
      timer.current = undefined;
    }
  }

  function begin(id: string) {
    const t = nextTaskId();
    setRunning(id);
    setStepIdx(0);
    setTaskId(t);
    setNote("");
  }

  function fire(id: string, idx: number, t: string): boolean {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc || idx >= sc.steps.length) return false;
    const step = sc.steps[idx];
    const outcome = runtime.process(step.build(t));
    onActivity();
    if (!outcome.accepted) {
      setNote(`Step rejected (by design): ${outcome.rejectionReason}`);
    } else {
      setNote("");
    }
    return true;
  }

  function stepOnce() {
    if (!running) return;
    if (fire(running, stepIdx, taskId)) setStepIdx(stepIdx + 1);
    else {
      setRunning(null);
      setNote("Scenario complete.");
    }
  }

  function runAll() {
    if (!running) return;
    stopTimer();
    let i = stepIdx;
    timer.current = window.setInterval(() => {
      if (!fire(running, i, taskId)) {
        stopTimer();
        setRunning(null);
        setStepIdx(0);
        setNote("Scenario complete.");
        return;
      }
      i += 1;
      setStepIdx(i);
    }, 900);
  }

  function resetAll() {
    stopTimer();
    setRunning(null);
    setStepIdx(0);
    setNote("");
    runtime.process(
      createEvent("reset", "user", { simulated: false }),
    );
    runtime.reset();
    onActivity();
  }

  const active = SCENARIOS.find((s) => s.id === running);

  return (
    <div className="scenario">
      <div className="sim-badge" style={{ alignSelf: "flex-start" }}>
        Simulation — not real analysis
      </div>
      {!active ? (
        SCENARIOS.map((s) => (
          <div key={s.id} className="sc-card">
            <h4>{s.title}</h4>
            <p>{s.description}</p>
            <div className="btnrow">
              <button className="btn primary" onClick={() => begin(s.id)}>
                Start
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="sc-card">
          <h4>{active.title}</h4>
          <p>
            Step {Math.min(stepIdx + 1, active.steps.length)} of{" "}
            {active.steps.length}
            {active.steps[stepIdx]
              ? ` — next: ${active.steps[stepIdx].label}`
              : " — done"}
          </p>
          <div className="btnrow">
            <button className="btn primary" onClick={stepOnce}>
              Step
            </button>
            <button className="btn" onClick={runAll}>
              Run all
            </button>
            <button className="btn" onClick={resetAll}>
              Stop
            </button>
          </div>
          {note && <p style={{ marginTop: 8 }}>{note}</p>}
        </div>
      )}
      <div className="sc-card">
        <h4>Manual triggers</h4>
        <p>Dispatch single events straight to the runtime.</p>
        <div className="btnrow">
          <button
            className="btn"
            onClick={() => {
              runtime.process(createEvent("input.received", "user"));
              onActivity();
            }}
          >
            Input
          </button>
          <button
            className="btn"
            onClick={() => {
              runtime.process(createEvent("processing.started", "user"));
              onActivity();
            }}
          >
            Think
          </button>
          <button
            className="btn"
            onClick={() => {
              runtime.process(
                createEvent("approval.requested", "user", {
                  payload: { operation: "Manual write op" },
                }),
              );
              onActivity();
            }}
          >
            Request approval
          </button>
          <button
            className="btn"
            onClick={() => {
              runtime.process(createEvent("approval.granted", "user"));
              onActivity();
            }}
          >
            Grant
          </button>
          <button
            className="btn"
            onClick={() => {
              runtime.process(
                createEvent("error.raised", "user", {
                  payload: { error: "Manual error trigger" },
                }),
              );
              onActivity();
            }}
          >
            Error
          </button>
          <button className="btn danger" onClick={resetAll}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
