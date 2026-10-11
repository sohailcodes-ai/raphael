import { describe, expect, it } from "vitest";
import {
  ALL_PRESENCE_STATES,
  PRESENCE_META,
  isPresenceState,
} from "../presenceStates";
import { canTransition, tryTransition, validTargets } from "../stateMachine";

describe("presence state model", () => {
  it("defines exactly the 13 required states", () => {
    expect(ALL_PRESENCE_STATES).toHaveLength(13);
    for (const s of [
      "dormant",
      "listening",
      "thinking",
      "analyzing",
      "hypothesizing",
      "experimenting",
      "executing",
      "awaiting_approval",
      "speaking",
      "verified",
      "uncertain",
      "warning",
      "error",
    ] as const) {
      expect(ALL_PRESENCE_STATES).toContain(s);
      expect(PRESENCE_META[s].label.length).toBeGreaterThan(0);
      expect(PRESENCE_META[s].description.length).toBeGreaterThan(0);
    }
  });

  it("guards the presence-state type predicate", () => {
    expect(isPresenceState("thinking")).toBe(true);
    expect(isPresenceState("flying")).toBe(false);
    expect(isPresenceState(undefined)).toBe(false);
  });
});

describe("state machine transitions", () => {
  it("starts implicitly at dormant and accepts input", () => {
    expect(canTransition("dormant", "listening")).toBe(true);
  });

  it("allows the core operating-cycle path", () => {
    const path = [
      "dormant",
      "listening",
      "thinking",
      "analyzing",
      "hypothesizing",
      "experimenting",
      "thinking",
      "executing",
      "verified",
      "dormant",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("allows self-transitions as safe no-ops", () => {
    for (const s of ALL_PRESENCE_STATES) {
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it("rejects unsafe jumps", () => {
    // Executing straight from dormant skips approval/analysis.
    expect(canTransition("dormant", "executing")).toBe(false);
    expect(canTransition("dormant", "verified")).toBe(false);
    expect(canTransition("listening", "verified")).toBe(false);
    expect(canTransition("dormant", "hypothesizing")).toBe(false);
  });

  it("pauses work for approval and resumes on grant", () => {
    expect(canTransition("experimenting", "awaiting_approval")).toBe(true);
    expect(canTransition("hypothesizing", "awaiting_approval")).toBe(true);
    expect(canTransition("awaiting_approval", "executing")).toBe(true);
    expect(canTransition("awaiting_approval", "dormant")).toBe(true);
  });

  it("restricts verified to states where checks can pass", () => {
    expect(canTransition("experimenting", "verified")).toBe(true);
    expect(canTransition("executing", "verified")).toBe(true);
    expect(canTransition("speaking", "verified")).toBe(true);
    expect(canTransition("analyzing", "verified")).toBe(false);
  });

  it("returns a reasoned rejection object", () => {
    const r = tryTransition("dormant", "executing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/dormant -> executing/);
  });

  it("recovers from error and warning", () => {
    expect(canTransition("error", "dormant")).toBe(true);
    expect(canTransition("error", "thinking")).toBe(true);
    expect(canTransition("warning", "thinking")).toBe(true);
    expect(validTargets("dormant").length).toBeGreaterThan(0);
  });
});
