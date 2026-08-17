/**
 * Ground truth. This module knows nothing about any sense — it describes what is
 * actually there, and each sense projects its own partial view of it. Keeping this
 * layer sense-agnostic is what lets echolocation, and later smell or heat, read the
 * same world without any of them owning it.
 */

export type Vec2 = { x: number; y: number };

export type Material = 'stone' | 'metal' | 'water' | 'soft';

export type Segment = { a: Vec2; b: Vec2; material: Material };

export type World = {
  walls: Segment[];
  /** Extent of the floor plan, used to fit the scene to a viewport. */
  size: { w: number; h: number };
};

/**
 * Fraction of incident energy a surface sends back. This is the whole reason
 * materials exist as a concept here: a soft surface is nearly invisible to a ping,
 * which later lets a predator have fur that barely answers.
 */
export const REFLECTIVITY: Record<Material, number> = {
  metal: 0.97,
  stone: 0.8,
  water: 0.5,
  // Low enough to read as a hole in the world, but not so low that distance pushes it
  // under the cutoff everywhere — at 0.14 it vanished from the scene entirely.
  soft: 0.3,
};

function wall(ax: number, ay: number, bx: number, by: number, material: Material): Segment {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, material };
}

/** Four walls, clockwise. Pillars and alcoves are just small boxes. */
function box(x: number, y: number, w: number, h: number, material: Material): Segment[] {
  return [
    wall(x, y, x + w, y, material),
    wall(x + w, y, x + w, y + h, material),
    wall(x + w, y + h, x, y + h, material),
    wall(x, y + h, x, y, material),
  ];
}

const W = 36;
const H = 64;

/**
 * A test chamber, built to make the physics legible rather than to be fun. It has a
 * head-on surface, sharply angled walls that should stay dark, a metal panel that
 * should come back far too bright, and a soft alcove that should read as a hole in
 * the world.
 */
export const TEST_WORLD: World = {
  size: { w: W, h: H },
  walls: [
    // Outer shell.
    ...box(2, 2, W - 4, H - 4, 'stone'),

    // Corridor walls running up the middle, with a gap on the left to step through.
    wall(11, 20, 11, 31, 'stone'),
    wall(11, 37, 11, 45, 'stone'),
    wall(25, 20, 25, 45, 'stone'),

    // Angled funnel below the corridor. At a glancing angle these should return
    // almost nothing, which is the clearest tell that this is not a flashlight.
    wall(11, 45, 5, 54, 'stone'),
    wall(25, 45, 31, 54, 'stone'),

    // Metal panel closing the far end. Head-on and highly reflective, but ~48 units
    // out — a distant landmark rather than the brightest thing here.
    wall(14, 7, 22, 7, 'metal'),

    // Soft alcove, top left. Should swallow a ping almost entirely.
    wall(4, 8, 4, 17, 'soft'),
    wall(4, 17, 12, 17, 'soft'),

    // Standing water, top right. Middling return, distinct from stone.
    wall(26, 9, 33, 9, 'water'),

    // Three pillars at matched range, so material is the only variable between them.
    // Anything further out and distance dominates the comparison.
    ...box(20, 40, 1.6, 1.6, 'metal'),
    ...box(17, 39, 1.6, 1.6, 'stone'),
    ...box(14, 40, 1.6, 1.6, 'soft'),

    // Deeper pillar, for depth reference.
    ...box(21, 26, 1.5, 1.5, 'stone'),
  ],
};

/** Where the listener stands. Fixed for v1 — movement comes with the game loop. */
export const LISTENER: Vec2 = { x: 18, y: 55 };
