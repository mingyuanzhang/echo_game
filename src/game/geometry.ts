/**
 * Ray casting against wall segments. Shared, because sound and bodies must agree about
 * where the walls are — if echolocation used one intersection test and movement used
 * another, the room you hear would drift from the room you can walk through.
 */

import type { Material, Segment, Vec2 } from './world';

export type Hit = {
  /** Distance along the ray, in world units. */
  t: number;
  point: Vec2;
  /** Unit normal, always flipped to face back toward the incoming ray. */
  normal: Vec2;
  material: Material;
};

export const EPSILON = 1e-4;

/** Nearest intersection of a ray with the world, or null if it escapes. */
export function castRay(walls: Segment[], origin: Vec2, dir: Vec2): Hit | null {
  let best: Hit | null = null;

  for (const seg of walls) {
    const sx = seg.b.x - seg.a.x;
    const sy = seg.b.y - seg.a.y;
    const denom = dir.x * sy - dir.y * sx;
    if (Math.abs(denom) < 1e-9) continue; // parallel

    const ox = seg.a.x - origin.x;
    const oy = seg.a.y - origin.y;
    const t = (ox * sy - oy * sx) / denom;
    const u = (ox * dir.y - oy * dir.x) / denom;

    if (t <= EPSILON || u < 0 || u > 1) continue;
    if (best && t >= best.t) continue;

    const len = Math.hypot(sx, sy) || 1;
    let nx = -sy / len;
    let ny = sx / len;
    if (nx * dir.x + ny * dir.y > 0) {
      nx = -nx;
      ny = -ny;
    }

    best = {
      t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t },
      normal: { x: nx, y: ny },
      material: seg.material,
    };
  }

  return best;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * True when the segment p1->p2 crosses q1->q2.
 *
 * Used for the exit test. Checking whether a step *ends* near a doorway is not enough:
 * a three-unit step can straddle a small target entirely and register nothing, and a
 * point-with-radius cannot cover the full width of an opening in the first place. A
 * crossing test has neither problem — you either passed through the doorway or you
 * did not.
 */
export function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;

  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return false; // parallel or degenerate

  const dx = q1.x - p1.x;
  const dy = q1.y - p1.y;
  const t = (dx * sy - dy * sx) / denom;
  const u = (dx * ry - dy * rx) / denom;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
