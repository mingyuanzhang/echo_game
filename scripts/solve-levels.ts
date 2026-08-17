/**
 * Computes the `best` figures in `src/game/levels.ts`: the fewest calls a level can be
 * escaped on, and the fewest steps achievable with that many calls.
 *
 * Those numbers are what scoring measures against, so guessing them is not an option —
 * too low and a full score is unreachable, too high and one is handed out for sloppy
 * play. Re-run this after touching any geometry:
 *
 *   npm run solve
 *
 * It is also the acceptance test for this port. Every route it finds is replayed through
 * the real reducer, so a clean run proves the raycasting, the movement model, the level
 * geometry and the scoring all still behave exactly as they did in the native build.
 *
 * The search is a breadth-first sweep over *legs*, where a leg is one call plus every
 * step taken on that heading. Legs are the expensive resource, so the frontier is
 * expanded a whole leg at a time and the first leg count that reaches the doorway is
 * the answer; steps break ties within it.
 *
 * The one trick worth knowing: a leg needs a single ray cast, not one per step. Every
 * step on a leg travels the same line, so the distance to the obstruction ahead simply
 * decreases by the step length, and the position after k steps is a closed form.
 *
 * Whatever it finds is then replayed through the real reducer, which is what stops this
 * file from quietly drifting away from the rules it is supposed to be measuring.
 */

import { castRay, segmentsCross } from '../src/game/geometry';
import { LEVELS, type Level } from '../src/game/levels';
import { initialRun, runReducer, scoreRun, STEP } from '../src/game/run';
import type { Vec2 } from '../src/game/world';

/** Must match `run.ts`, or the routes found here are not routes the game allows. */
const CLEARANCE = 0.35;

/** Angular resolution of the search. A tap on a phone is finer than this. */
const HEADINGS = 720;

/**
 * Positions are merged onto a lattice this coarse before being expanded again, which is
 * what keeps the frontier finite. Merging can only ever hide a route, never invent one —
 * every state carries its true position, so anything found is exactly playable.
 */
const CELL = 0.5;

type State = {
  pos: Vec2;
  steps: number;
  /** How this position was arrived at, for replaying the route afterwards. */
  from: State | null;
  heading: number;
};

type Solution = { pings: number; moves: number; legs: { heading: number; steps: number }[] };

function solve(level: Level): Solution | null {
  const { walls } = level.world;
  const { exit } = level;
  const maxSteps = Math.ceil(Math.hypot(level.world.size.w, level.world.size.h) / STEP) + 2;

  const key = (p: Vec2) => `${Math.round(p.x / CELL)},${Math.round(p.y / CELL)}`;

  /** The sequence of calls and step counts that produced a state. */
  function legsTo(end: State): { heading: number; steps: number }[] {
    const legs: { heading: number; steps: number }[] = [];
    for (let s: State = end; s.from; s = s.from) {
      legs.unshift({ heading: s.heading, steps: s.steps - s.from.steps });
    }
    return legs;
  }

  /** Walk one leg from `from` on `heading`, collecting where it reaches. */
  function leg(from: State, heading: number, out: State[]): State | null {
    const dir = { x: Math.cos(heading), y: Math.sin(heading) };
    const hit = castRay(walls, from.pos, dir);
    // A ray that hits nothing has left through an opening; the step cap bounds it.
    const free = hit ? Math.max(0, hit.t - CLEARANCE) : Infinity;

    let prev = from.pos;
    for (let k = 1; k <= maxSteps; k++) {
      const d = Math.min(STEP * k, free);
      const pos = { x: from.pos.x + dir.x * d, y: from.pos.y + dir.y * d };
      const here: State = { pos, steps: from.steps + k, from, heading };
      if (segmentsCross(prev, pos, exit.a, exit.b)) return here;

      // Flush against the wall: further steps cost moves and change nothing.
      const blocked = d >= free - 1e-9;
      out.push(here);
      if (blocked) break;
      prev = pos;
    }
    return null;
  }

  const start: State = { pos: level.start, steps: 0, from: null, heading: level.startHeading };
  const seen = new Map<string, number>([[key(level.start), 0]]);

  // Leg zero: the heading you wake up on is already set, so walking it is free. Its
  // states hang off `start` with no leg of their own, which is what makes them free.
  let frontier: State[] = [start];
  const zeroth: State[] = [];
  const freeEscape = leg(start, level.startHeading, zeroth);
  if (freeEscape) return { pings: 0, moves: freeEscape.steps, legs: [] };
  for (const s of zeroth) {
    const k = key(s.pos);
    const prior = seen.get(k);
    if (prior === undefined || s.steps < prior) {
      seen.set(k, s.steps);
      frontier.push({ ...s, from: null });
    }
  }

  for (let pings = 1; pings <= 12; pings++) {
    const reached = new Map<string, State>();
    let best: State | null = null;
    const landed: State[] = [];

    for (const from of frontier) {
      if (best && from.steps >= best.steps) continue;
      for (let i = 0; i < HEADINGS; i++) {
        landed.length = 0;
        const escaped = leg(from, (i * 2 * Math.PI) / HEADINGS, landed);
        if (escaped && (!best || escaped.steps < best.steps)) best = escaped;

        for (const s of landed) {
          const k = key(s.pos);
          const prior = seen.get(k);
          if (prior !== undefined && s.steps >= prior) continue;
          seen.set(k, s.steps);
          reached.set(k, s);
        }
      }
    }

    if (best) return { pings, moves: best.steps, legs: legsTo(best) };
    if (reached.size === 0) return null;
    frontier = [...reached.values()];
  }

  return null;
}

/**
 * Play the route through the actual game and report what the actual game thought of it.
 * A route the reducer does not agree escapes means this script's movement model has
 * drifted from `run.ts`, and every number it has ever printed is suspect.
 */
function replay(level: Level, found: Solution): string | null {
  let run = initialRun(level);
  // The free opening leg, if the route used one: its steps precede the first call.
  const opening = found.moves - found.legs.reduce((n, l) => n + l.steps, 0);
  for (let i = 0; i < opening; i++) run = runReducer(run, { type: 'STEP' });
  for (const { heading, steps } of found.legs) {
    run = runReducer(run, { type: 'CALL', heading });
    for (let i = 0; i < steps; i++) run = runReducer(run, { type: 'STEP' });
  }

  if (run.status !== 'escaped') return `route does not escape (${run.status})`;
  if (run.pings !== found.pings || run.moves !== found.moves) {
    return `route costs ${run.pings}/${run.moves}, not ${found.pings}/${found.moves}`;
  }
  const score = scoreRun({ ...run, level: { ...level, best: found } });
  if (score !== 1000) return `optimal route scores ${score}, not 1000`;
  return null;
}

let bad = 0;
for (const level of LEVELS) {
  const t0 = Date.now();
  const found = solve(level);
  const held = level.best;

  if (!found) {
    console.log(`${level.id.padEnd(18)} UNREACHABLE — the doorway cannot be crossed`);
    bad++;
    continue;
  }

  const drift = replay(level, found);
  const agrees = found.pings === held.pings && found.moves === held.moves;
  if (drift || !agrees) bad++;
  console.log(
    `${level.id.padEnd(18)} pings: ${found.pings}, moves: ${String(found.moves).padEnd(3)} ` +
      `${agrees ? 'ok' : `FILE SAYS ${held.pings}/${held.moves}`.padEnd(18)} ` +
      `${drift ? `MODEL DRIFT: ${drift}` : ''}  (${Date.now() - t0}ms)`,
  );
}

console.log(bad ? `\n${bad} level(s) need attention` : '\nall levels agree with the file');
