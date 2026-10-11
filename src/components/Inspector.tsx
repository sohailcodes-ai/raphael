/**
 * Inspector.tsx — Expanded diagnostic view: knowledge grades, experiments,
 * approvals, and verification records. Read-only; reflects runtime stores.
 */

import { runtime } from "../hooks/useRuntime";

export function Inspector({ tick }: { tick: number }) {
  void tick;
  const hyps = runtime.getHypotheses();
  const exps = runtime.getExperiments();
  const approvals = runtime.getApprovals();
  const verifs = runtime.getVerifications();
  const pending = runtime.getPendingApproval();
  const changes = [...runtime.getChangeLog()].slice(-12).reverse();

  return (
    <div>
      {pending && (
        <div className="sc-card" style={{ marginBottom: 8 }}>
          <h4>Approval pending</h4>
          <p>
            {pending.operation} — paused until granted or denied. Use the
            scenario panel to grant.
          </p>
        </div>
      )}
      <h4 style={{ margin: "4px 0 2px", fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>
        HYPOTHESES ({hyps.length})
      </h4>
      {hyps.length === 0 && <p className="tl-empty">None proposed.</p>}
      {[...hyps].reverse().map((h) => (
        <div key={h.id} className={`hyp${h.status === "rejected" ? " rejected" : ""}`}>
          <div style={{ fontSize: 12 }}>{h.statement}</div>
          <div className="t" style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>
            grade: {h.grade} · {h.status}
            {h.simulated ? " · sim" : ""}
          </div>
        </div>
      ))}

      <h4 style={{ margin: "10px 0 2px", fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>
        EXPERIMENTS ({exps.length})
      </h4>
      {exps.length === 0 && <p className="tl-empty">None run.</p>}
      {[...exps].reverse().map((e) => (
        <div key={e.id} className={`exp ${e.status === "failed" ? "failed" : e.status === "passed" ? "passed" : ""}`}>
          <div style={{ fontSize: 12 }}>{e.description}</div>
          <div style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>
            {e.status}
            {e.checks.length > 0 &&
              ` · ${e.checks.filter((c) => c.passed).length}/${e.checks.length} checks passed`}
            {e.simulated ? " · sim" : ""}
          </div>
        </div>
      ))}

      <h4 style={{ margin: "10px 0 2px", fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>
        VERIFICATIONS ({verifs.length})
      </h4>
      {verifs.length === 0 && <p className="tl-empty">None recorded.</p>}
      {[...verifs].reverse().map((v, i) => (
        <div key={i} className="tl-item">
          <div className="t">{new Date(v.at).toLocaleTimeString("en-GB", { hour12: false })}</div>
          <div>{v.passed ? "passed" : "FAILED"} — {v.checks.length} check(s)</div>
        </div>
      ))}

      <h4 style={{ margin: "10px 0 2px", fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>
        STATE CHANGES ({changes.length})
      </h4>
      {changes.length === 0 && <p className="tl-empty">No transitions yet.</p>}
      <dl className="kv">
        {changes.map((c, i) => (
          <div key={i} style={{ display: "contents" }}>
            <dt>{c.from} →</dt>
            <dd>{c.to}</dd>
          </div>
        ))}
      </dl>

      {approvals.length > 0 && (
        <>
          <h4 style={{ margin: "10px 0 2px", fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>
            APPROVALS ({approvals.length})
          </h4>
          {[...approvals].reverse().map((a) => (
            <div key={a.id} className="tl-item">
              <div>{a.operation}</div>
              <div className="t">{a.status}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
