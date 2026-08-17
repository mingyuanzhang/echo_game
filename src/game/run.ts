/**
 * A single escape attempt. Pure state transitions, no React and no rendering — the same
 * shape as the Tetris reducer, so the rules can be read and tested on their own.
 *
 * Note what this module does *not* hold: echoes. Calling produces sound, and sound is
 * the renderer's problem; the run only records that a call happened and what it cost.
 */

import { castRay, segmentsCross } from './geometry';
import type { Level } from './levels';
import type { Vec2 } from './world';

export type RunStatus = 'playing' | 'escaped' | 'surrendered';

export type Call = { at: Vec2; heading: number };

export type RunState = {
  level: Level;
  pos: Vec2;
  /**
   * The direction a step would take. Set by calling — you walk where you last looked —
   * or by turning, which is free and tells you nothing.
   */
  heading: number;
  pings: number;
  moves: number;
  /** Every position occupied, start included. Drawn as the path in the debrief. */
  path: Vec2[];
  calls: Call[];
  /** True when the last step was stopped short by a wall. */
  blocked: boolean;
  status: RunStatus;
};

export type RunAction =
  | { type: 'CALL'; heading: number }
  | { type: 'TURN'; heading: number }
  | { type: 'STEP' }
  | { type: 'GIVE_UP' }
  | { type: 'RESTART' }
  | { type: 'LOAD'; level: Level };

/** How far one step carries you. */
export const STEP = 3;

/** Stop this far short of a wall rather than ending up flush against it. */
const CLEARANCE = 0.35;

export function initialRun(level: Level): RunState {
  return {
    level,
    pos: level.start,
    heading: level.startHeading,
    pings: 0,
    moves: 0,
    path: [level.start],
    calls: [],
    blocked: false,
    status: 'playing',
  };
}

/**
 * Advance along a heading, stopping short of whatever is in the way. Movement uses the
 * same cast as echolocation, so you can never walk through a wall you could have heard.
 */
function advance(state: RunState, heading: number): { pos: Vec2; blocked: boolean } {
  const dir = { x: Math.cos(heading), y: Math.sin(heading) };
  const hit = castRay(state.level.world.walls, state.pos, dir);
  const limit = hit ? Math.max(0, hit.t - CLEARANCE) : STEP;
  const travelled = Math.min(STEP, limit);

  return {
    pos: { x: state.pos.x + dir.x * travelled, y: state.pos.y + dir.y * travelled },
    blocked: travelled < STEP - 1e-6,
  };
}

export function runReducer(state: RunState, action: RunAction): RunState {
  // Both start a fresh run, so they apply whatever the current status is.
  if (action.type === 'RESTART') return initialRun(state.level);
  if (action.type === 'LOAD') return initialRun(action.level);
  if (state.status !== 'playing') return state;

  switch (action.type) {
    case 'CALL':
      return {
        ...state,
        heading: action.heading,
        pings: state.pings + 1,
        calls: [...state.calls, { at: state.pos, heading: action.heading }],
        blocked: false,
      };

    /**
     * Turning on the spot. You can always face a different way without announcing it —
     * a body pivots in silence — so this costs nothing and is recorded nowhere. What it
     * does not do is tell you anything: you are now walking into a direction you have
     * not heard, which is exactly the trade being offered.
     *
     * Clears `blocked` for the same reason calling does. That flag means "the last step
     * hit something ahead", and ahead has just moved.
     */
    case 'TURN':
      return { ...state, heading: action.heading, blocked: false };

    case 'STEP': {
      const { pos, blocked } = advance(state, state.heading);
      const { exit } = state.level;
      // Tested against the whole step, not just where it lands — a three-unit stride
      // can otherwise straddle the doorway and carry you out into open space forever.
      const escaped = segmentsCross(state.pos, pos, exit.a, exit.b);

      return {
        ...state,
        pos,
        blocked,
        moves: state.moves + 1,
        path: [...state.path, pos],
        status: escaped ? 'escaped' : 'playing',
      };
    }

    case 'GIVE_UP':
      return { ...state, status: 'surrendered' };
  }
}

/**
 * What each wasted call and each wasted step costs against a perfect run. Calls were
 * cheaper to waste when the beam was wide; a 20-degree call sees far less per use, so
 * honest searching now takes several and the penalty was lowered to match.
 */
const CALL_PENALTY = 30;
const MOVE_PENALTY = 35;

/** The least an escape can be worth, so it never ties with surrendering. */
const ESCAPE_FLOOR = 60;

/**
 * Escaping starts from 1000 and pays for every call and step beyond the optimum, so the
 * score is strictly decreasing in both — using the sense less always scores better, and
 * a full 1000 requires the perfect line off a single call. Giving up scores nothing at
 * all; the run has to end in the doorway to be worth anything.
 *
 * Calls cost more than steps because information is the scarce resource here. Walking
 * blind is meant to be the cheap, frightening option.
 */
export function scoreRun(state: RunState): number {
  if (state.status !== 'escaped') return 0;

  const { best } = state.level;
  const wastedCalls = Math.max(0, state.pings - best.pings);
  const wastedMoves = Math.max(0, state.moves - best.moves);
  const earned = 1000 - wastedCalls * CALL_PENALTY - wastedMoves * MOVE_PENALTY;

  // Floored rather than allowed to reach zero: however badly you blundered around,
  // getting out has to be worth more than giving up, or the two outcomes read the same.
  return Math.max(ESCAPE_FLOOR, Math.round(earned));
}

/** Coarse grade for the debrief, so a number has some meaning attached to it. */
export function grade(score: number): string {
  if (score === 0) return '—';
  if (score >= 950) return 'FLAWLESS';
  if (score >= 820) return 'SHARP';
  if (score >= 650) return 'CAPABLE';
  if (score >= 450) return 'CLUMSY';
  return 'LOST';
}
