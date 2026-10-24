import { useCallback, useEffect, useState } from "react";
import { Sigil } from "./components/Sigil";
import { Timeline } from "./components/Timeline";
import { ScenarioPanel } from "./components/ScenarioPanel";
import { Inspector } from "./components/Inspector";
import { ConversationPanel } from "./components/ConversationPanel";
import { runtime, usePresence } from "./hooks/useRuntime";
import { createEvent } from "./runtime/events";
import { PRESENCE_META } from "./runtime/presenceStates";

type Tab = "conversation" | "scenarios" | "timeline" | "inspector";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

async function win(cmd: "minimize" | "close") {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    if (cmd === "minimize") await w.minimize();
    else await w.close();
  } catch {
    if (cmd === "close") window.close();
  }
}

export default function App() {
  const state = usePresence();
  const [tab, setTab] = useState<Tab>("conversation");
  const [tick, setTick] = useState(0);
  const poke = useCallback(() => setTick((t) => t + 1), []);
  const meta = PRESENCE_META[state];
  const branches = runtime
    .getHypotheses()
    .filter((h) => h.status === "proposed").length;

  // Keyboard-accessible core controls.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "r" && !e.ctrlKey && !e.metaKey && (e.target as HTMLElement)?.tagName !== "INPUT") {
        runtime.process(createEvent("reset", "user"));
        runtime.reset();
        poke();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poke]);

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region={isTauri() ? true : undefined}>
        <span className="drag">RAPHAEL · PRESENCE RUNTIME v0.2</span>
        <div className="winbtns">
          <button className="winbtn" aria-label="Toggle inspector" title="Toggle inspector (I)" onClick={() => setTab("inspector")}>
            ◫
          </button>
          {isTauri() && (
            <>
              <button className="winbtn" aria-label="Minimize" onClick={() => void win("minimize")}>–</button>
              <button className="winbtn" aria-label="Close" onClick={() => void win("close")}>✕</button>
            </>
          )}
        </div>
      </div>

      <div className="main">
        <section className="presence" aria-label="Presence view">
          <Sigil state={state} branches={branches} size={210} />
          <div className="state-pill" data-state={state} role="status" aria-live="polite">
            <span className="dot" aria-hidden="true" />
            {meta.label}
          </div>
          <div className="state-desc">{meta.description}</div>
        </section>

        <div className="tabs" role="tablist">
          {(["conversation", "scenarios", "timeline", "inspector"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className="tab"
              onClick={() => setTab(t)}
            >
              {t === "conversation" ? "Conversation" : t === "scenarios" ? "Scenarios" : t === "timeline" ? "Timeline" : "Inspector"}
            </button>
          ))}
        </div>
        <div className="tabpane" role="tabpanel">
          {tab === "conversation" && <ConversationPanel />}
          {tab === "scenarios" && <ScenarioPanel onActivity={poke} />}
          {tab === "timeline" && <Timeline tick={tick} />}
          {tab === "inspector" && <Inspector tick={tick} />}
        </div>
      </div>

      <div className="footerbar">
        <span>state: {state}</span>
        <span className="spacer" />
        <span>I: inspector · R: reset</span>
      </div>
    </div>
  );
}
