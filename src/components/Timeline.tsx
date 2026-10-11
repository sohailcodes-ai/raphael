/**
 * Timeline.tsx — Readable event timeline for development and debugging.
 * Renders exactly what the runtime received: accepted events, state changes,
 * and rejections. Simulated entries are badged; never presented as real work.
 */

import { useSyncExternalStore } from "react";
import { runtime } from "../hooks/useRuntime";
import type { RuntimeEvent } from "../runtime/events";

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
}

function describe(e: RuntimeEvent): string {
  const sim = e.simulated ? " [sim]" : "";
  const task = e.taskId ? ` · ${e.taskId}` : "";
  return `${e.type}${task}${sim}`;
}

export function Timeline({ tick }: { tick: number }) {
  useSyncExternalStore(
    (cb) => runtime.subscribe(() => cb()),
    () => runtime.getState(),
  );
  void tick;
  const events = [...runtime.getEventLog()].slice(-40).reverse();
  const rejected = runtime.getRejected();

  if (events.length === 0) {
    return <div className="tl-empty">No events yet. Run a scenario.</div>;
  }
  return (
    <div className="timeline" role="log" aria-label="Runtime event timeline">
      {events.map((e) => (
        <div key={e.id} className={`tl-item${e.simulated ? " sim" : ""}`}>
          <div className="t">
            {time(e.timestamp)} · {e.source}
          </div>
          <div>{describe(e)}</div>
        </div>
      ))}
      {rejected.length > 0 && (
        <>
          {[...rejected].slice(-8).reverse().map((r, i) => (
            <div key={`rej-${i}`} className="tl-item rejected">
              <div className="t">{time(r.at)} · rejected</div>
              <div>
                {r.event.type}: {r.reason}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
