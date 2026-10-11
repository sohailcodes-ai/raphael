/**
 * Sigil.tsx — The RAPHAEL Sigil. Original authored SVG geometry.
 *
 * Asymmetric crystalline structure: a central shard, three independent
 * satellite shards, and two thin orbital arcs. Each presence state maps to
 * a deterministic arrangement + motion quality through one coherent system
 * (CSS classes driven solely by the `state` prop, which mirrors runtime).
 *
 * No downloaded assets. No glow-for-identity: the silhouette reads without
 * effects. Reduced-motion users get a static arrangement per state.
 */

import type { PresenceState } from "../runtime/presenceStates";

interface SigilProps {
  state: PresenceState;
  /** Number of visibly distinct hypothesis branches (0 = none). */
  branches?: number;
  size?: number;
}

/** Satellite shard offsets per state: [x, y, rotation]. */
const FRAGMENTS: Record<PresenceState, [number, number, number][]> = {
  dormant: [[26, -18, 12], [-28, 6, -20], [6, 28, 30]],
  listening: [[32, -22, 18], [-34, 8, -26], [8, 34, 36]],
  thinking: [[24, -16, 40], [-26, 4, 50], [4, 26, 60]],
  analyzing: [[18, -30, 0], [-18, -28, 0], [0, 20, 0]],
  hypothesizing: [[38, -14, 24], [-38, -10, -24], [0, 40, 12]],
  experimenting: [[14, -10, 60], [-14, 2, 70], [2, 14, 80]],
  executing: [[22, -20, 90], [-22, 0, 100], [0, 22, 110]],
  awaiting_approval: [[30, -20, 0], [-30, 4, 0], [4, 32, 0]],
  speaking: [[28, -18, 14], [-30, 6, -22], [6, 30, 32]],
  verified: [[10, -8, 0], [-10, 0, 0], [0, 10, 0]],
  uncertain: [[30, -12, 44], [-24, 12, -48], [10, 30, 20]],
  warning: [[32, -20, 8], [-32, 6, -8], [6, 34, 4]],
  error: [[20, -24, -14], [-20, 14, 18], [-2, -32, 40]],
};

const ACCENT: Record<PresenceState, string> = {
  dormant: "#8b93a7",
  listening: "#aeb8d6",
  thinking: "#9db1ff",
  analyzing: "#8fd0ff",
  hypothesizing: "#b9a7ff",
  experimenting: "#9db1ff",
  executing: "#c9d4ff",
  awaiting_approval: "#d8c690",
  speaking: "#e8ecf7",
  verified: "#eef1fa",
  uncertain: "#8b93a7",
  warning: "#c9a7ff",
  error: "#ff9d9d",
};

export function Sigil({ state, branches = 0, size = 200 }: SigilProps) {
  const frags = FRAGMENTS[state];
  const accent = ACCENT[state];
  const showBranches = state === "hypothesizing" && branches >= 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox="-60 -60 120 120"
      role="img"
      aria-label={`Raphael Sigil, state: ${state}`}
      className={`sigil sigil--${state}`}
    >
      {/* orbital arcs — thin silver structure, rotation speed varies by state */}
      <g className="sigil-ring sigil-ring--a" stroke="#c7ccd9" opacity={0.55}>
        <circle cx="0" cy="0" r="44" fill="none" strokeWidth="1" strokeDasharray="70 206" strokeLinecap="round" />
      </g>
      <g className="sigil-ring sigil-ring--b" stroke="#6f7490" opacity={0.6}>
        <circle cx="0" cy="0" r="36" fill="none" strokeWidth="1" strokeDasharray="30 196" strokeLinecap="round" />
      </g>

      {/* hypothesis branches — visibly distinct paths, count = active hypotheses */}
      {showBranches && (
        <g stroke={accent} strokeWidth="1" opacity={0.8}>
          {Array.from({ length: Math.min(branches, 4) }).map((_, i) => {
            const angle = -50 + i * (100 / Math.max(branches - 1, 1));
            const rad = (angle * Math.PI) / 180;
            const x2 = Math.sin(rad) * 52;
            const y2 = -Math.cos(rad) * 52;
            return (
              <line key={i} x1={0} y1={-14} x2={x2} y2={y2} strokeDasharray="3 3" className="sigil-branch" />
            );
          })}
        </g>
      )}

      {/* central shard — asymmetric crystalline core, authored geometry */}
      <g className="sigil-core">
        <polygon
          points="0,-26 11,-6 6,22 -8,16 -13,-8"
          fill="#e9edf6"
          stroke="#ffffff"
          strokeWidth="1"
          opacity={0.96}
        />
        <polygon points="0,-26 11,-6 1,-2" fill="#b9c2da" opacity={0.9} />
        <polygon points="-13,-8 -1,-2 6,22 -8,16" fill="#aab4cf" opacity={0.85} />
        <line x1="0" y1="-26" x2="1" y2="-2" stroke="#ffffff" strokeWidth="0.75" opacity={0.8} />
      </g>

      {/* satellite shards — independent elements that separate / converge */}
      {frags.map(([x, y, r], i) => (
        <g
          key={i}
          className="sigil-frag"
          style={{ ["--fx" as string]: `${x}px`, ["--fy" as string]: `${y}px`, ["--fr" as string]: `${r}deg` }}
        >
          <polygon
            points={i === 1 ? "0,-7 5,3 -4,5" : "0,-8 5,4 -5,3"}
            fill={i === 2 ? accent : "#cfd5e4"}
            stroke="#f2f4fa"
            strokeWidth="0.75"
            opacity={0.92}
          />
        </g>
      ))}

      {/* accent node — restrained blue-violet, intensity carries state meaning */}
      <circle cx="0" cy="-2" r="2.4" fill={accent} className="sigil-node" />
    </svg>
  );
}
