import { describe, expect, it, vi } from "vitest";
import { createEvent } from "../events";
import { RaphaelRuntime } from "../processor";

function fresh() {
  return new RaphaelRuntime();
}

function drive(rt: RaphaelRuntime, withSim = false) {
  const src = withSim ? "scenario" : "user";
  rt.process(createEvent("input.received", src, { simulated: withSim }));
  rt.process(createEvent("processing.started", src, { simulated: withSim }));
}

describe("RaphaelRuntime initialization", () => {
  it("starts dormant with empty logs", () => {
    const rt = fresh();
    expect(rt.getState()).toBe("dormant");
    expect(rt.getEventLog()).toHaveLength(0);
    expect(rt.getPendingApproval()).toBeUndefined();
  });
});

describe("event processing", () => {
  it("advances state on valid events and notifies subscribers", () => {
    const rt = fresh();
    const seen: string[] = [];
    rt.subscribe((s) => seen.push(s));
    drive(rt);
    expect(rt.getState()).toBe("thinking");
    expect(seen).toEqual(["listening", "thinking"]);
  });

  it("rejects invalid transitions without touching state", () => {
    const rt = fresh();
    const out = rt.process(createEvent("execution.started", "user"));
    expect(out.accepted).toBe(false);
    expect(rt.getState()).toBe("dormant");
    expect(rt.getRejected()).toHaveLength(1);
  });

  it("rejects malformed events safely", () => {
    const rt = fresh();
    const out = rt.process({} as never);
    expect(out.accepted).toBe(false);
    expect(rt.getState()).toBe("dormant");
  });

  it("isolates subscriber exceptions from the runtime", () => {
    const rt = fresh();
    rt.subscribe(() => {
      throw new Error("bad subscriber");
    });
    const good = vi.fn();
    rt.subscribe(good);
    drive(rt);
    expect(good).toHaveBeenCalled();
    expect(rt.getState()).toBe("thinking");
  });
});

describe("hypotheses and experiments", () => {
  it("records hypotheses as hypotheses — never as facts", () => {
    const rt = fresh();
    drive(rt);
    rt.process(
      createEvent("hypotheses.proposed", "analysis", {
        taskId: "t1",
        payload: { statements: ["H1", "H2"] },
      }),
    );
    expect(rt.getState()).toBe("hypothesizing");
    const hyps = rt.getHypotheses();
    expect(hyps).toHaveLength(2);
    for (const h of hyps) {
      expect(h.grade).toBe("hypothesis");
      expect(h.status).toBe("proposed");
    }
  });

  it("marks rejected hypotheses and failed experiments visibly", () => {
    const rt = fresh();
    drive(rt);
    rt.process(
      createEvent("hypotheses.proposed", "analysis", {
        payload: { statements: ["H1", "H2"] },
      }),
    );
    rt.process(createEvent("experiment.started", "experiment"));
    expect(rt.getState()).toBe("experimenting");
    rt.process(
      createEvent("hypothesis.rejected", "experiment", {
        payload: { note: "evidence against H2" },
      }),
    );
    expect(rt.getHypotheses().filter((h) => h.status === "rejected")).toHaveLength(1);
    rt.process(
      createEvent("experiment.failed", "experiment", {
        payload: { checks: [{ name: "c1", passed: false }] },
      }),
    );
    expect(rt.getState()).toBe("error");
    expect(rt.getExperiments()[0].status).toBe("failed");
  });
});

describe("approval gate", () => {
  it("pauses on approval.requested and resumes only on grant", () => {
    const rt = fresh();
    drive(rt);
    rt.process(
      createEvent("hypotheses.proposed", "analysis", {
        payload: { statements: ["H1"] },
      }),
    );
    const req = rt.process(
      createEvent("approval.requested", "approval", {
        payload: { operation: "write file", approvalId: "a1" },
      }),
    );
    expect(req.accepted).toBe(true);
    expect(rt.getState()).toBe("awaiting_approval");
    expect(rt.getPendingApproval()?.operation).toBe("write file");

    const grant = rt.process(createEvent("approval.granted", "approval"));
    expect(grant.accepted).toBe(true);
    expect(rt.getState()).toBe("executing");
    expect(rt.getPendingApproval()).toBeUndefined();
  });

  it("stands down cleanly on denial", () => {
    const rt = fresh();
    drive(rt);
    rt.process(
      createEvent("approval.requested", "approval", {
        payload: { operation: "risky op" },
      }),
    );
    // awaiting_approval -> dormant requires going through denial path state;
    // denial targets dormant only from awaiting_approval — valid.
    const out = rt.process(createEvent("approval.denied", "approval"));
    expect(out.accepted).toBe(true);
    expect(rt.getState()).toBe("dormant");
  });
});

describe("verification gate", () => {
  it("reaches verified only with passing checks", () => {
    const rt = fresh();
    drive(rt);
    rt.process(createEvent("experiment.started", "experiment"));
    rt.process(
      createEvent("experiment.completed", "experiment", {
        payload: { checks: [{ name: "c1", passed: true }] },
      }),
    );
    rt.process(createEvent("execution.started", "executor"));
    const ok = rt.process(
      createEvent("verified", "verifier", {
        payload: { checks: [{ name: "success condition", passed: true }] },
      }),
    );
    expect(ok.accepted).toBe(true);
    expect(rt.getState()).toBe("verified");
  });

  it("rejects verified claims without passing checks — no fake success", () => {
    const rt = fresh();
    drive(rt);
    rt.process(createEvent("experiment.started", "experiment"));
    rt.process(
      createEvent("experiment.completed", "experiment", {
        payload: { checks: [{ name: "c1", passed: true }] },
      }),
    );
    rt.process(createEvent("execution.started", "executor"));
    const bad = rt.process(
      createEvent("verified", "verifier", { payload: { checks: [] } }),
    );
    expect(bad.accepted).toBe(false);
    expect(rt.getState()).not.toBe("verified");
    const verifs = rt.getVerifications();
    expect(verifs[verifs.length - 1]?.passed).toBe(false);
  });

  it("raises uncertainty and warning truthfully", () => {
    const rt = fresh();
    drive(rt);
    expect(rt.process(createEvent("uncertainty.raised", "analysis")).accepted).toBe(true);
    expect(rt.getState()).toBe("uncertain");
    expect(rt.process(createEvent("processing.started", "user")).accepted).toBe(true);
    expect(rt.process(createEvent("warning.raised", "system")).accepted).toBe(true);
    expect(rt.getState()).toBe("warning");
  });
});
