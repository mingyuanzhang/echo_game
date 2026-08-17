/**
 * Levels. A level is a world plus the few facts a run needs: where you wake up, what
 * counts as out, and what a perfect escape costs.
 *
 * Every `best` in this file was computed by exhaustive search over headings and step
 * counts, not estimated — scoring measures deviation from it, so a wrong value either
 * puts a full score out of reach or hands one out for sloppy play. `scripts/solve-levels.ts`
 * is that search; re-run it after touching any geometry.
 *
 * The set is ordered as a difficulty curve: one room, then corridors that turn, then
 * rooms that are not rectangles, then rooms with things in them, then flats with several
 * rooms to cross, and finally mazes.
 *
 * What bounds the sizes is the sense itself. Past about 35 units a stone wall returns
 * less than the intensity cutoff, so a far wall and an open door become the same thing —
 * both simply silent — and inference turns into guessing. No level puts a feature you
 * are meant to hear further than that from anywhere you are meant to stand, which is
 * why the later ones grow by adding rooms rather than by growing rooms.
 */

import type { Material, Segment, Vec2, World } from './world';

export type Level = {
  id: string;
  name: string;
  world: World;
  start: Vec2;
  startHeading: number;
  /**
   * The doorway itself, as a segment spanning the full width of the opening. Crossing it
   * is an escape. Spanning the whole gap matters: anything narrower can be walked around
   * along a wall, and past the opening there is usually nothing left to stop you.
   */
  exit: { a: Vec2; b: Vec2 };
  /** The verified optimum: fewest calls, and fewest moves achievable with them. */
  best: { pings: number; moves: number };
};

const RAD = Math.PI / 180;

function wall(ax: number, ay: number, bx: number, by: number, material: Material): Segment {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, material };
}

/** Four walls, clockwise. Pillars, furniture and slabs are all just small closed boxes. */
function box(x: number, y: number, w: number, h: number, material: Material): Segment[] {
  return [
    wall(x, y, x + w, y, material),
    wall(x + w, y, x + w, y + h, material),
    wall(x + w, y + h, x, y + h, material),
    wall(x, y + h, x, y, material),
  ];
}

/**
 * A circular wall as a chain of chords, running from `fromDeg` round to `toDeg`. The
 * doorway is simply the arc left undrawn — openings are absences here, in the geometry
 * as much as in the sense.
 */
function arc(
  cx: number,
  cy: number,
  r: number,
  fromDeg: number,
  toDeg: number,
  steps: number,
  material: Material,
): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < steps; i++) {
    const a0 = (fromDeg + ((toDeg - fromDeg) * i) / steps) * RAD;
    const a1 = (fromDeg + ((toDeg - fromDeg) * (i + 1)) / steps) * RAD;
    segs.push(
      wall(
        cx + r * Math.cos(a0),
        cy + r * Math.sin(a0),
        cx + r * Math.cos(a1),
        cy + r * Math.sin(a1),
        material,
      ),
    );
  }
  return segs;
}

/** The chord closing a circular room's doorway, from one lip of the gap to the other. */
function doorChord(c: { cx: number; cy: number; r: number; door: number; half: number }) {
  return {
    a: onCircle(c.cx, c.cy, c.r, c.door - c.half),
    b: onCircle(c.cx, c.cy, c.r, c.door + c.half),
  };
}

/** Point on a circle, for placing exits in the middle of a gap. */
function onCircle(cx: number, cy: number, r: number, deg: number): Vec2 {
  return { x: cx + r * Math.cos(deg * RAD), y: cy + r * Math.sin(deg * RAD) };
}

// --- Mazes -----------------------------------------------------------------

type Side = 'n' | 's' | 'e' | 'w';

/**
 * A maze written as the passages that exist rather than the walls that do — which is
 * how it is actually played, since what you hear of a maze is where the sound gets
 * through. Every shared edge is a wall unless it appears in `open`, and every boundary
 * edge is a wall unless it is the door.
 *
 * `panels` re-materials individual walls. A soft panel is the cruelest thing in the
 * game: it swallows a call almost entirely, so a dead end can be made to answer exactly
 * like a way out.
 */
function gridMaze(g: {
  cols: number;
  rows: number;
  /** Side of one cell, in world units. */
  cell: number;
  x0: number;
  y0: number;
  /**
   * Width of a doorway. Deliberately much less than `cell`: an opening the full width
   * of a cell edge is barely an opening at all, and a maze made of them can be crossed
   * corner to corner on a single diagonal, which is neither findable nor a maze.
   */
  gap: number;
  /** Passages, as `'c,r-c,r'` between orthogonally adjacent cells. */
  open: string[];
  /** The way out: a doorway in a boundary edge. */
  door: { cell: [number, number]; side: Side };
  material: Material;
  /** Per-edge material overrides, keyed `'c,r-c,r'` inside or `'c,r:n'` on the boundary. */
  panels?: Record<string, Material>;
}): { walls: Segment[]; gap: { a: Vec2; b: Vec2 }; center: (c: number, r: number) => Vec2 } {
  const open = new Set<string>();
  for (const key of g.open) {
    const [a, b] = key.split('-');
    open.add(`${a}-${b}`);
    open.add(`${b}-${a}`);
  }

  const px = (c: number) => g.x0 + c * g.cell;
  const py = (r: number) => g.y0 + r * g.cell;
  const doorKey = `${g.door.cell[0]},${g.door.cell[1]}:${g.door.side}`;

  const walls: Segment[] = [];
  const found: { a: Vec2; b: Vec2 }[] = [];

  /**
   * How far a doorway sits from the middle of its edge. Centred doorways line up into
   * diagonal chains a single heading can be fired straight down — the first draft of
   * these mazes could be crossed corner to corner on one call. Shifting each opening by
   * a fixed amount derived from its cell breaks every such line while keeping the maze
   * fully connected, since the shift is always smaller than the jambs it moves between.
   */
  const shift = (c: number, r: number) => (((c * 3 + r * 5) % 3) - 1) * ((g.cell - g.gap) / 3);

  /**
   * One cell edge. Solid edges are a single wall; pierced ones become the two jambs
   * either side of the opening, and the opening itself is what is left out.
   */
  const edge = (
    key: string,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    pierced: boolean,
    off: number,
  ) => {
    const material = g.panels?.[key] ?? g.material;
    if (!pierced) {
      walls.push(wall(ax, ay, bx, by, material));
      return;
    }
    const lo = (1 - g.gap / g.cell) / 2 + off / g.cell;
    const at = (t: number) => ({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    const a = at(lo);
    const b = at(lo + g.gap / g.cell);
    walls.push(wall(ax, ay, a.x, a.y, material));
    walls.push(wall(b.x, b.y, bx, by, material));
    if (key === doorKey) found.push({ a, b });
  };

  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const here = `${c},${r}`;
      const off = shift(c, r);
      // Each cell draws its own north and west edge, so interior walls are never
      // doubled; the last row and column close themselves off afterwards.
      const north = `${here}:n`;
      const west = `${here}:w`;
      if (r === 0) edge(north, px(c), py(r), px(c + 1), py(r), north === doorKey, off);
      else {
        const k = `${here}-${c},${r - 1}`;
        edge(k, px(c), py(r), px(c + 1), py(r), open.has(k), off);
      }

      if (c === 0) edge(west, px(c), py(r), px(c), py(r + 1), west === doorKey, -off);
      else {
        const k = `${here}-${c - 1},${r}`;
        edge(k, px(c), py(r), px(c), py(r + 1), open.has(k), -off);
      }

      if (r === g.rows - 1) {
        const k = `${here}:s`;
        edge(k, px(c), py(r + 1), px(c + 1), py(r + 1), k === doorKey, -off);
      }
      if (c === g.cols - 1) {
        const k = `${here}:e`;
        edge(k, px(c + 1), py(r), px(c + 1), py(r + 1), k === doorKey, off);
      }
    }
  }

  if (found.length !== 1) throw new Error(`maze door ${doorKey} is not on the boundary`);
  return {
    walls,
    gap: found[0],
    center: (c, r) => ({ x: px(c) + g.cell / 2, y: py(r) + g.cell / 2 }),
  };
}

// --- 1-5: one room, and the first turn --------------------------------------

/**
 * One room, one open door. Rays through the gap escape and never return, so the way out
 * reads as a wedge of silence in an otherwise answering wall.
 */
export const ROOM_01: Level = {
  id: 'room-01',
  name: 'ONE DOOR',
  world: {
    size: { w: 24, h: 30 },
    walls: [
      wall(2, 2, 10, 2, 'stone'),
      wall(13.5, 2, 22, 2, 'stone'),
      wall(22, 2, 22, 28, 'stone'),
      wall(22, 28, 2, 28, 'stone'),
      wall(2, 28, 2, 2, 'stone'),
    ],
  },
  start: { x: 5.5, y: 24 },
  startHeading: Math.PI / 2,
  // Spans the gap in the top wall exactly.
  exit: { a: { x: 10, y: 2 }, b: { x: 13.5, y: 2 } },
  best: { pings: 1, moves: 8 },
};

// A 24-degree gap: narrower than this and the 45-degree call overspills so much onto
// the wall either side that the opening stops reading as silence.
const C1 = { cx: 17, cy: 17, r: 13.5, door: 200, half: 12 };

/**
 * A ring, and you are exactly in the middle of it. Every wall is the same distance away,
 * so the entire room answers at one uniform brightness and the door is the only thing
 * that breaks the symmetry. The cleanest possible statement of the core mechanic.
 */
export const CIRCLE_CENTER: Level = {
  id: 'circle-center',
  name: 'THE RING',
  world: {
    size: { w: 34, h: 34 },
    walls: arc(C1.cx, C1.cy, C1.r, C1.door + C1.half, C1.door - C1.half + 360, 44, 'stone'),
  },
  start: { x: C1.cx, y: C1.cy },
  startHeading: -Math.PI / 2,
  exit: doorChord(C1),
  best: { pings: 1, moves: 5 },
};

/**
 * The same ring, but standing off to one side. Now the near wall is enormously louder
 * than the far one, and the door is on the quiet side — the curve gives you no flat
 * surfaces to orient against, so distance is all you have.
 */
export const CIRCLE_SIDE: Level = {
  id: 'circle-side',
  name: 'OFF CENTRE',
  world: {
    size: { w: 34, h: 34 },
    walls: arc(C1.cx, C1.cy, C1.r, C1.door + C1.half, C1.door - C1.half + 360, 44, 'stone'),
  },
  start: onCircle(C1.cx, C1.cy, 9.5, C1.door - 180),
  startHeading: Math.PI / 2,
  exit: doorChord(C1),
  best: { pings: 1, moves: 8 },
};

/**
 * Wedged into a corner of a long room, with the way out diagonally opposite. Two walls
 * are close enough to drown everything else, and both of them meet in a corner behind
 * you — the feature most easily mistaken for an opening.
 */
export const RECT_CORNER: Level = {
  id: 'rect-corner',
  name: 'THE CORNER',
  // Sized so the far wall sits inside sensing range. Any longer and the exit corner
  // returns nothing at all, which would make a distant wall and an opening look
  // identical — both simply dark — and turn the level into guesswork.
  world: {
    size: { w: 26, h: 28 },
    walls: [
      wall(2, 2, 24, 2, 'stone'),
      wall(24, 2, 24, 26, 'stone'),
      // Bottom wall, split by the doorway. The gap sits near the middle rather than out
      // by the far corner: with only three units of wall between the two, the corner and
      // the opening fall inside a single call, and a corner is the loudest thing a room
      // can return — its two faces answer twice over and drown the silence beside them.
      // The level is about a corner you can hear behind you, not about one you cannot
      // separate from the way out.
      wall(24, 26, 15, 26, 'stone'),
      wall(11.5, 26, 2, 26, 'stone'),
      wall(2, 26, 2, 2, 'stone'),
    ],
  },
  start: { x: 6, y: 6 },
  startHeading: -Math.PI / 2,
  // Spans the gap in the bottom wall exactly.
  exit: { a: { x: 11.5, y: 26 }, b: { x: 15, y: 26 } },
  best: { pings: 1, moves: 7 },
};

/**
 * An L of corridors. Corridor walls run nearly parallel to any call you make down them,
 * so they return almost nothing — the passage reads as darkness ahead rather than as
 * walls to either side. The turn is a hole in a wall you can barely hear in the first
 * place, and it cannot be taken on one heading.
 */
export const CORRIDOR_TURN: Level = {
  id: 'corridor-turn',
  name: 'THE TURN',
  world: {
    size: { w: 40, h: 44 },
    walls: [
      wall(8, 40, 13, 40, 'stone'), // closed end, behind you
      wall(8, 8, 8, 40, 'stone'), // long outer wall
      wall(8, 8, 34, 8, 'stone'), // top wall, running the length of both arms
      wall(13, 13, 34, 13, 'stone'), // inner wall of the second corridor
      wall(13, 13, 13, 40, 'stone'), // inner wall of the first corridor
    ],
  },
  start: { x: 10.5, y: 37 },
  startHeading: Math.PI / 2,
  // The full width of the corridor mouth, wall to wall — anything narrower could be
  // walked past along either wall, and beyond it there is nothing left to stop you.
  exit: { a: { x: 34, y: 8 }, b: { x: 34, y: 13 } },
  // Two legs are unavoidable, but the corner can be cut diagonally rather than walked
  // as two axis-aligned runs. One move more than it looks, because the threshold has to
  // be crossed outright rather than merely reached.
  best: { pings: 2, moves: 16 },
};

// --- 6-9: corridors that turn more than once --------------------------------

/**
 * Two turns instead of one, in opposite directions. The second turn has to be found
 * from inside the first — you arrive in the cross passage with no idea which way along
 * it the way out lies, and both ends sound the same until you are level with them.
 *
 * Six units wide, not five, and this matters more than it looks. A step is three
 * units, so in a five-wide passage the stride lands inside the crossing exactly once:
 * one step short of it every direction answers — the side wall at arm's length, the far
 * wall a few units on — and the honest conclusion from that call is that the corridor is
 * a dead end. Widening the passage puts two or three positions inside the crossing
 * instead of one, so the opening is something you walk through rather than something you
 * have to be standing on the right tile to hear.
 */
export const CORRIDOR_S: Level = {
  id: 'corridor-s',
  name: 'THE BEND',
  world: {
    size: { w: 32, h: 38 },
    walls: [
      wall(8, 34, 14, 34, 'stone'), // closed end, behind you
      wall(8, 34, 8, 16, 'stone'), // outer wall of the first arm
      wall(8, 16, 20, 16, 'stone'), // far wall of the cross passage
      wall(20, 16, 20, 4, 'stone'), // outer wall of the last arm
      wall(26, 4, 26, 22, 'stone'), // the long return wall
      wall(26, 22, 14, 22, 'stone'), // near wall of the cross passage
      wall(14, 22, 14, 34, 'stone'), // inner wall of the first arm
    ],
  },
  start: { x: 11, y: 31 },
  startHeading: Math.PI / 2,
  exit: { a: { x: 20, y: 4 }, b: { x: 26, y: 4 } },
  best: { pings: 3, moves: 11 },
};

/**
 * A snake: four arms, three turns, each one hidden inside the last. Nothing here is
 * hard on its own — it is the accumulation, and the fact that a wrong turn costs you
 * the walk back as well as the walk out.
 *
 * Six units wide for the same reason as [THE BEND], and three times over: a corridor
 * that can only be turned out of from one exact position is a puzzle about where you
 * happened to stop, and this one would have asked that question three times.
 */
export const CORRIDOR_ZIGZAG: Level = {
  id: 'corridor-zigzag',
  name: 'ZIGZAG',
  world: {
    size: { w: 38, h: 40 },
    walls: [
      wall(6, 36, 6, 22, 'stone'),
      wall(6, 22, 18, 22, 'stone'),
      wall(18, 22, 18, 6, 'stone'),
      wall(18, 6, 34, 6, 'stone'),
      wall(34, 12, 24, 12, 'stone'),
      wall(24, 12, 24, 28, 'stone'),
      wall(24, 28, 12, 28, 'stone'),
      wall(12, 28, 12, 36, 'stone'),
      wall(12, 36, 6, 36, 'stone'),
    ],
  },
  start: { x: 9, y: 33 },
  startHeading: Math.PI / 2,
  exit: { a: { x: 34, y: 6 }, b: { x: 34, y: 12 } },
  best: { pings: 4, moves: 13 },
};

/**
 * A T, and only one arm goes anywhere. This is the first level about listening to a
 * difference rather than to a thing: the closed arm answers from its end wall, the open
 * one answers with nothing at all. Turn the wrong way and you learn it at the far end.
 */
export const CORRIDOR_FORK: Level = {
  id: 'corridor-fork',
  name: 'THE FORK',
  world: {
    size: { w: 38, h: 40 },
    walls: [
      wall(16, 36, 21, 36, 'stone'), // closed end, behind you
      wall(16, 36, 16, 12, 'stone'),
      wall(16, 12, 6, 12, 'stone'), // near wall of the dead arm
      wall(6, 12, 6, 7, 'stone'), // the dead end itself
      wall(6, 7, 32, 7, 'stone'), // far wall, running the whole crossbar
      wall(32, 12, 21, 12, 'stone'), // near wall of the live arm
      wall(21, 12, 21, 36, 'stone'),
    ],
  },
  start: { x: 18.5, y: 33 },
  startHeading: Math.PI / 2,
  exit: { a: { x: 32, y: 7 }, b: { x: 32, y: 12 } },
  best: { pings: 2, moves: 11 },
};

/**
 * The corridor doubles back on itself, and the door is a few metres from where you woke
 * up — with a wall in between. Everything about the sound says you are getting further
 * from where you started, which is exactly right and completely useless.
 */
export const CORRIDOR_HOOK: Level = {
  id: 'corridor-hook',
  name: 'DOUBLING BACK',
  world: {
    size: { w: 34, h: 38 },
    walls: [
      wall(8, 34, 13, 34, 'stone'), // closed end, behind you
      wall(8, 34, 8, 5, 'stone'),
      wall(8, 5, 30, 5, 'stone'),
      wall(30, 5, 30, 32, 'stone'),
      wall(25, 32, 25, 10, 'stone'), // the spine between the two arms
      wall(25, 10, 13, 10, 'stone'),
      wall(13, 10, 13, 34, 'stone'),
    ],
  },
  start: { x: 10.5, y: 31 },
  startHeading: -Math.PI / 2,
  exit: { a: { x: 25, y: 32 }, b: { x: 30, y: 32 } },
  best: { pings: 2, moves: 20 },
};

// --- 10-13: rooms that are not rectangles -----------------------------------

/**
 * A room that narrows. Both long walls are raked, so they throw almost everything away
 * from you and answer far more faintly than their distance deserves — the room sounds
 * bigger and emptier than it is, and the door is in the narrow end you cannot hear.
 */
export const ROOM_WEDGE: Level = {
  id: 'room-wedge',
  name: 'THE WEDGE',
  world: {
    size: { w: 32, h: 38 },
    walls: [
      wall(4, 34, 28, 34, 'stone'), // the broad end, behind you
      wall(28, 34, 20, 6, 'stone'),
      wall(20, 6, 18, 6, 'stone'),
      wall(14.5, 6, 12, 6, 'stone'),
      wall(12, 6, 4, 34, 'stone'),
    ],
  },
  start: { x: 16, y: 30 },
  startHeading: Math.PI / 2,
  exit: { a: { x: 14.5, y: 6 }, b: { x: 18, y: 6 } },
  best: { pings: 1, moves: 8 },
};

/**
 * Four arms from one hub, three of them blind. From the middle every arm sounds like
 * open space; only from inside does an arm tell you whether it ends. The door is a gap
 * in the end of one of them, so even the right arm answers loudly before it answers
 * truthfully.
 */
export const ROOM_CROSS: Level = {
  id: 'room-cross',
  name: 'THE CROSS',
  world: {
    size: { w: 34, h: 34 },
    walls: [
      wall(13, 3, 21, 3, 'stone'), // north end
      wall(21, 3, 21, 13, 'stone'),
      wall(21, 13, 31, 13, 'stone'),
      wall(31, 13, 31, 15, 'stone'), // east end, split by the door
      wall(31, 19, 31, 21, 'stone'),
      wall(31, 21, 21, 21, 'stone'),
      wall(21, 21, 21, 31, 'stone'),
      wall(21, 31, 13, 31, 'stone'), // south end, behind you
      wall(13, 31, 13, 21, 'stone'),
      wall(13, 21, 3, 21, 'stone'),
      wall(3, 21, 3, 13, 'stone'), // west end
      wall(3, 13, 13, 13, 'stone'),
      wall(13, 13, 13, 3, 'stone'),
    ],
  },
  start: { x: 17, y: 28 },
  startHeading: Math.PI / 2,
  exit: { a: { x: 31, y: 15 }, b: { x: 31, y: 19 } },
  best: { pings: 2, moves: 7 },
};

/**
 * Eight flat facets around you. Each one answers only when you are nearly square-on to
 * it, so a single call lights two or three faces and leaves the rest dark — and a dark
 * facet and the missing one sound alike until you turn toward them.
 */
export const ROOM_VAULT: Level = {
  id: 'room-vault',
  name: 'THE VAULT',
  world: {
    size: { w: 34, h: 34 },
    // Seven facets of eight. The eighth, from 0 to 45 degrees, is the door.
    walls: arc(17, 17, 13, 45, 360, 7, 'stone'),
  },
  start: onCircle(17, 17, 9, 202.5),
  startHeading: Math.PI,
  exit: { a: onCircle(17, 17, 13, 0), b: onCircle(17, 17, 13, 45) },
  best: { pings: 1, moves: 8 },
};

/**
 * A hall with two side chambers, one of which has a way out of the building. From the
 * hall both openings sound identical; the difference is entirely at the far end of each
 * chamber, and to hear it you have to commit to going in.
 */
export const ROOM_GALLERY: Level = {
  id: 'room-gallery',
  name: 'THE GALLERY',
  world: {
    size: { w: 32, h: 38 },
    walls: [
      wall(6, 4, 6, 34, 'stone'), // the long blind wall
      wall(6, 4, 14, 4, 'stone'),
      wall(6, 34, 14, 34, 'stone'),
      // The hall's other side, broken by the two chamber mouths.
      wall(14, 4, 14, 8, 'stone'),
      wall(14, 16, 14, 22, 'stone'),
      wall(14, 30, 14, 34, 'stone'),
      // Near chamber: a room with nothing in it and no way on.
      wall(14, 8, 14, 10, 'stone'),
      wall(14, 14, 14, 16, 'stone'),
      wall(14, 8, 27, 8, 'stone'),
      wall(27, 8, 27, 16, 'stone'),
      wall(27, 16, 14, 16, 'stone'),
      // Far chamber: same mouth, same size, and a door in the back wall.
      wall(14, 22, 14, 24, 'stone'),
      wall(14, 28, 14, 30, 'stone'),
      wall(14, 22, 27, 22, 'stone'),
      wall(27, 22, 27, 24, 'stone'),
      wall(27, 28, 27, 30, 'stone'),
      wall(27, 30, 14, 30, 'stone'),
    ],
  },
  start: { x: 10, y: 7 },
  startHeading: Math.PI / 2,
  exit: { a: { x: 27, y: 24 }, b: { x: 27, y: 28 } },
  best: { pings: 1, moves: 12 },
};

// --- 14-17: things in the way -----------------------------------------------

/**
 * The first room with anything in it. Pillars are small and bright and close, so they
 * dominate every call and hide whole stretches of wall behind them — the room you build
 * from the returns has walls where there are none and gaps where there is stone.
 */
export const ROOM_PILLARS: Level = {
  id: 'room-pillars',
  name: 'PILLARS',
  world: {
    size: { w: 32, h: 36 },
    walls: [
      wall(3, 3, 13, 3, 'stone'),
      wall(17, 3, 29, 3, 'stone'),
      wall(29, 3, 29, 33, 'stone'),
      wall(29, 33, 3, 33, 'stone'),
      wall(3, 33, 3, 3, 'stone'),
      ...box(9, 10, 1.6, 1.6, 'stone'),
      ...box(17, 10, 1.6, 1.6, 'stone'),
      ...box(23, 14, 1.6, 1.6, 'stone'),
      ...box(11, 20, 1.6, 1.6, 'stone'),
      ...box(19, 22, 1.6, 1.6, 'stone'),
      ...box(7, 26, 1.6, 1.6, 'stone'),
      ...box(24, 25, 1.6, 1.6, 'stone'),
    ],
  },
  start: { x: 21, y: 29 },
  startHeading: Math.PI / 2,
  exit: { a: { x: 13, y: 3 }, b: { x: 17, y: 3 } },
  best: { pings: 1, moves: 11 },
};

/**
 * One large obstruction, squarely between you and the door. Call toward the way out and
 * a broad flat surface answers at close range — the single most convincing "this is a
 * wall, there is nothing that way" the game can produce. It is a wall. It is also nine
 * units wide, with clear floor either side of it.
 */
export const ROOM_SLAB: Level = {
  id: 'room-slab',
  name: 'THE SLAB',
  world: {
    size: { w: 30, h: 35 },
    walls: [
      wall(3, 3, 12, 3, 'stone'),
      wall(17, 3, 27, 3, 'stone'),
      wall(27, 3, 27, 32, 'stone'),
      wall(27, 32, 3, 32, 'stone'),
      wall(3, 32, 3, 3, 'stone'),
      ...box(9, 12, 12, 6, 'stone'),
    ],
  },
  start: { x: 15, y: 28 },
  // Aimed straight at the door, and straight at the slab. The free first step walks
  // you into it, which is the cheapest possible way to be taught this level's lesson.
  startHeading: -Math.PI / 2,
  exit: { a: { x: 12, y: 3 }, b: { x: 17, y: 3 } },
  best: { pings: 2, moves: 10 },
};

/**
 * A furnished room. The soft pieces are the point: upholstery returns almost nothing,
 * so a sofa reads as a hole in the world in exactly the way a doorway does. Everything
 * that sounds like an opening in here is worth one step and no more.
 */
export const ROOM_CLUTTER: Level = {
  id: 'room-clutter',
  name: 'CLUTTER',
  world: {
    size: { w: 34, h: 34 },
    walls: [
      wall(3, 3, 31, 3, 'stone'),
      wall(31, 3, 31, 14, 'stone'),
      wall(31, 18, 31, 31, 'stone'),
      wall(31, 31, 3, 31, 'stone'),
      wall(3, 31, 3, 3, 'stone'),
      ...box(8, 8, 5, 3, 'soft'), // a bed
      ...box(17, 7, 3, 3, 'metal'), // something with a steel face
      ...box(9, 18, 4, 4, 'stone'),
      ...box(20, 20, 6, 2.5, 'soft'), // a sofa, and a lie
      ...box(24, 10, 2, 6, 'stone'),
    ],
  },
  start: { x: 6, y: 27 },
  startHeading: -Math.PI / 2,
  exit: { a: { x: 31, y: 14 }, b: { x: 31, y: 18 } },
  best: { pings: 1, moves: 10 },
};

/**
 * A five-unit stretch of the east wall is soft — hung with something, or rotted — and it
 * returns so little that it is indistinguishable from a doorway. The actual way out is
 * a genuine gap in the floor-level wall behind you, and it is quieter than the fake.
 */
export const ROOM_FALSE_DOOR: Level = {
  id: 'room-false-door',
  name: 'THE FALSE DOOR',
  world: {
    size: { w: 32, h: 34 },
    walls: [
      wall(3, 3, 29, 3, 'stone'),
      wall(29, 3, 29, 13, 'stone'),
      wall(29, 13, 29, 18, 'soft'), // the lie
      wall(29, 18, 29, 31, 'stone'),
      wall(29, 31, 12, 31, 'stone'),
      wall(8, 31, 3, 31, 'stone'),
      wall(3, 31, 3, 3, 'stone'),
    ],
  },
  start: { x: 16, y: 10 },
  // Facing the false door, because of course you are.
  startHeading: 0,
  exit: { a: { x: 8, y: 31 }, b: { x: 12, y: 31 } },
  best: { pings: 1, moves: 8 },
};

// --- 18-21: flats, with rooms to cross before the front door ----------------

/**
 * Not a room any more but a flat: you have to get out of where you are before you can
 * start on getting out at all. The interior door is narrow and the far room is beyond
 * hearing from where you wake, so the first half of this is done on one fact.
 */
export const FLAT_TWO_ROOMS: Level = {
  id: 'flat-two-rooms',
  name: 'TWO ROOMS',
  world: {
    size: { w: 40, h: 30 },
    walls: [
      // The room you wake in.
      wall(4, 4, 18, 4, 'stone'),
      wall(4, 4, 4, 20, 'stone'),
      wall(4, 20, 18, 20, 'stone'),
      // The party wall, with the door through it. Set high deliberately: with the two
      // doorways in line, one call from the right spot takes you the whole way, and a
      // flat that can be left on a single heading is not a flat.
      wall(18, 4, 18, 6, 'stone'),
      wall(18, 10, 18, 20, 'stone'),
      wall(18, 20, 18, 26, 'stone'),
      // The room with the front door in it.
      wall(18, 4, 36, 4, 'stone'),
      wall(36, 4, 36, 16, 'stone'),
      wall(36, 20, 36, 26, 'stone'),
      wall(36, 26, 18, 26, 'stone'),
    ],
  },
  start: { x: 8, y: 16 },
  startHeading: Math.PI / 2,
  exit: { a: { x: 36, y: 16 }, b: { x: 36, y: 20 } },
  best: { pings: 2, moves: 11 },
};

/**
 * Three rooms off a hallway, and the hallway is the whole answer — it runs to the front
 * door and nothing else does. Two of the three doors lead into rooms that sound
 * spacious, promising and closed.
 */
export const FLAT_HALLWAY: Level = {
  id: 'flat-hallway',
  name: 'THE FLAT',
  world: {
    size: { w: 42, h: 38 },
    walls: [
      // Hallway, running the width of the flat to the front door at its east end.
      wall(4, 16, 4, 34, 'stone'),
      wall(4, 16, 7, 16, 'stone'),
      wall(11, 16, 22, 16, 'stone'),
      wall(26, 16, 38, 16, 'stone'),
      wall(4, 22, 14, 22, 'stone'),
      wall(18, 22, 38, 22, 'stone'),
      // The room you wake in.
      wall(4, 4, 14, 4, 'stone'),
      wall(4, 4, 4, 16, 'stone'),
      wall(14, 4, 14, 16, 'stone'),
      // Second room, closed.
      wall(18, 4, 30, 4, 'stone'),
      wall(18, 4, 18, 16, 'stone'),
      wall(30, 4, 30, 16, 'stone'),
      // Third room, closed.
      wall(10, 34, 26, 34, 'stone'),
      wall(10, 22, 10, 34, 'stone'),
      wall(26, 22, 26, 34, 'stone'),
    ],
  },
  start: { x: 8, y: 8 },
  startHeading: -Math.PI / 2,
  // The full width of the hallway where it opens onto the street.
  exit: { a: { x: 38, y: 16 }, b: { x: 38, y: 22 } },
  best: { pings: 2, moves: 12 },
};

/**
 * A furnished flat with a hall off it, and a cupboard off the hall. Furniture first,
 * then a door, then a choice between two openings a few units apart — one of which is
 * a metre-deep cupboard, and sounds like a room until you are inside it.
 */
export const FLAT_LANDING: Level = {
  id: 'flat-landing',
  name: 'THE LANDING',
  world: {
    size: { w: 40, h: 34 },
    walls: [
      // Living room.
      wall(6, 4, 24, 4, 'stone'),
      wall(6, 4, 6, 22, 'stone'),
      wall(6, 22, 24, 22, 'stone'),
      wall(24, 4, 24, 8, 'stone'),
      wall(24, 12, 24, 22, 'stone'),
      ...box(10, 8, 6, 3, 'soft'),
      ...box(17, 14, 3, 3, 'stone'),
      ...box(8, 16, 4, 2, 'metal'),
      // Hall, running down to the front door.
      wall(24, 4, 30, 4, 'stone'),
      wall(30, 4, 30, 8, 'stone'),
      wall(30, 12, 30, 30, 'stone'),
      wall(24, 22, 24, 30, 'stone'),
      // The cupboard, which is not a room.
      wall(30, 6, 36, 6, 'stone'),
      wall(36, 6, 36, 12, 'stone'),
      wall(36, 12, 30, 12, 'stone'),
    ],
  },
  start: { x: 10, y: 18 },
  startHeading: -Math.PI / 2,
  exit: { a: { x: 24, y: 30 }, b: { x: 30, y: 30 } },
  best: { pings: 3, moves: 13 },
};

/**
 * The full flat: bedroom, hall, two closed rooms off it, and the way out down a short
 * entry passage at the far end. Nothing here is new — it is the first level where you
 * have to hold a whole floor plan in your head at once.
 */
export const FLAT_NIGHT: Level = {
  id: 'flat-night',
  name: 'NIGHT FLAT',
  world: {
    size: { w: 40, h: 40 },
    walls: [
      // Bedroom.
      wall(4, 4, 20, 4, 'stone'),
      wall(20, 4, 20, 18, 'stone'),
      // Hall, and the entry passage hanging off its west end. The bedroom door is at
      // the far end of the bedroom from the passage, so leaving is three headings
      // whatever you do — no line crosses both openings.
      wall(4, 4, 4, 34, 'stone'),
      wall(4, 18, 14, 18, 'stone'),
      wall(18, 18, 28, 18, 'stone'),
      wall(32, 18, 36, 18, 'stone'),
      wall(10, 24, 28, 24, 'stone'),
      wall(32, 24, 36, 24, 'stone'),
      wall(36, 18, 36, 24, 'stone'), // the hall's blind end
      wall(10, 24, 10, 34, 'stone'),
      // Bathroom, closed.
      wall(24, 4, 36, 4, 'stone'),
      wall(24, 4, 24, 18, 'stone'),
      wall(36, 4, 36, 18, 'stone'),
      // Kitchen, closed.
      wall(24, 36, 36, 36, 'stone'),
      wall(24, 24, 24, 36, 'stone'),
      wall(36, 24, 36, 36, 'stone'),
    ],
  },
  start: { x: 8, y: 8 },
  startHeading: -Math.PI / 2,
  exit: { a: { x: 4, y: 34 }, b: { x: 10, y: 34 } },
  best: { pings: 3, moves: 10 },
};

// --- 22-25: mazes -----------------------------------------------------------

/**
 * A maze, which is only a corridor that lies more often. Three real turns and one long
 * branch that goes nowhere; the branch is the first thing you meet.
 */
const WARREN = gridMaze({
  cols: 3,
  rows: 3,
  cell: 7,
  x0: 4,
  y0: 4,
  gap: 3,
  open: [
    '0,2-1,2',
    '1,2-1,1',
    '1,1-0,1',
    '0,1-0,0',
    '0,0-1,0',
    '1,0-2,0',
    // The branch: inviting, and two cells deep.
    '1,2-2,2',
    '2,2-2,1',
  ],
  door: { cell: [2, 0], side: 'n' },
  material: 'stone',
});

export const MAZE_WARREN: Level = {
  id: 'maze-warren',
  name: 'THE WARREN',
  world: { size: { w: 29, h: 29 }, walls: WARREN.walls },
  start: WARREN.center(0, 2),
  startHeading: Math.PI / 2,
  exit: WARREN.gap,
  best: { pings: 4, moves: 12 },
};

/**
 * Sixteen cells, and the longest false path in the game runs along the bottom of it —
 * four cells of perfectly good corridor ending in stone. The way out doubles back over
 * the route you would take if you were only following the open air.
 */
const LATTICE = gridMaze({
  cols: 4,
  rows: 4,
  cell: 7,
  x0: 4,
  y0: 4,
  gap: 3,
  open: [
    '0,3-0,2',
    '0,2-1,2',
    '1,2-1,1',
    '1,1-2,1',
    '2,1-2,0',
    '2,0-3,0',
    // The long lie, along the bottom and up the east side.
    '0,3-1,3',
    '1,3-2,3',
    '2,3-3,3',
    '3,3-3,2',
    // Two shorter ones.
    '1,1-1,0',
    '1,0-0,0',
    '0,0-0,1',
    '2,1-2,2',
  ],
  door: { cell: [3, 0], side: 'n' },
  material: 'stone',
});

export const MAZE_LATTICE: Level = {
  id: 'maze-lattice',
  name: 'THE LATTICE',
  world: { size: { w: 36, h: 36 }, walls: LATTICE.walls },
  start: LATTICE.center(0, 3),
  startHeading: -Math.PI / 2,
  exit: LATTICE.gap,
  best: { pings: 2, moves: 12 },
};

/**
 * The same idea, wet and rotten. Two of the interior walls are soft and answer like
 * open passages; one boundary wall is sheet metal and answers like nothing else in the
 * game, which makes it the only landmark you can trust.
 */
const CISTERN = gridMaze({
  cols: 4,
  rows: 4,
  cell: 7,
  x0: 4,
  y0: 4,
  gap: 3,
  open: [
    '0,0-1,0',
    '1,0-1,1',
    '1,1-2,1',
    '2,1-2,2',
    '2,2-3,2',
    '3,2-3,3',
    // West and south: a long, plausible, useless run.
    '0,0-0,1',
    '0,1-0,2',
    '0,2-0,3',
    '0,3-1,3',
    // North-east: another.
    '2,1-2,0',
    '2,0-3,0',
    '3,0-3,1',
  ],
  door: { cell: [3, 3], side: 's' },
  material: 'stone',
  panels: {
    // Both of these sit on the route and sound exactly like the way through.
    '1,1-1,2': 'soft',
    '2,2-2,3': 'soft',
    '3,3:e': 'metal',
  },
});

export const MAZE_CISTERN: Level = {
  id: 'maze-cistern',
  name: 'THE CISTERN',
  world: { size: { w: 36, h: 36 }, walls: CISTERN.walls },
  start: CISTERN.center(0, 0),
  startHeading: Math.PI,
  exit: CISTERN.gap,
  best: { pings: 2, moves: 12 },
};

/**
 * Twenty cells, four dead ends, two soft walls and one metal one, and the door is in
 * the far corner from where you wake. Everything the game has taught, at once, with the
 * longest walk in it.
 */
const LAST = gridMaze({
  cols: 5,
  rows: 4,
  cell: 7,
  x0: 4,
  y0: 4,
  gap: 3,
  open: [
    '0,3-0,2',
    '0,2-1,2',
    '1,2-1,1',
    '1,1-2,1',
    '2,1-2,0',
    '2,0-3,0',
    '3,0-4,0',
    // The bottom run: five cells of nothing.
    '0,3-1,3',
    '1,3-2,3',
    '2,3-3,3',
    '3,3-4,3',
    '4,3-4,2',
    // North-west.
    '1,1-1,0',
    '1,0-0,0',
    '0,0-0,1',
    // And two short ones near the end, for when you think you are nearly out.
    '2,1-2,2',
    '2,2-3,2',
    '3,0-3,1',
  ],
  door: { cell: [4, 0], side: 'e' },
  material: 'stone',
  panels: {
    '1,0-2,0': 'soft',
    '3,1-3,2': 'soft',
    '0,0:n': 'metal',
  },
});

export const MAZE_LAST: Level = {
  id: 'maze-last',
  name: 'THE LAST DOOR',
  world: { size: { w: 43, h: 36 }, walls: LAST.walls },
  start: LAST.center(0, 3),
  startHeading: -Math.PI / 2,
  exit: LAST.gap,
  best: { pings: 3, moves: 14 },
};

// ---------------------------------------------------------------------------

export const LEVELS: Level[] = [
  ROOM_01,
  CIRCLE_CENTER,
  CIRCLE_SIDE,
  RECT_CORNER,
  CORRIDOR_TURN,
  // Ordered by what the solver says each actually costs, which was not the order they
  // were written in: the fork is one binary choice and the shortest walk of the four,
  // and the zigzag asks the same question three times over, so it goes last.
  CORRIDOR_FORK,
  CORRIDOR_S,
  CORRIDOR_HOOK,
  CORRIDOR_ZIGZAG,
  ROOM_WEDGE,
  ROOM_CROSS,
  ROOM_VAULT,
  ROOM_GALLERY,
  ROOM_PILLARS,
  ROOM_SLAB,
  ROOM_CLUTTER,
  ROOM_FALSE_DOOR,
  FLAT_TWO_ROOMS,
  FLAT_HALLWAY,
  FLAT_LANDING,
  FLAT_NIGHT,
  MAZE_WARREN,
  MAZE_LATTICE,
  MAZE_CISTERN,
  MAZE_LAST,
];

/**
 * How many levels you are allowed to quit out of. The first few are a tutorial and
 * being shown the room you failed to read is the lesson; after that, the map is the
 * reward for getting out, and the only way to see one is to earn it.
 */
export const MERCY_LEVELS = 5;
