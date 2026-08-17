/**
 * One presentation of an echo: marks on a screen. Everything here is a choice about
 * how to *show* sound, which is exactly why it lives apart from `echo.ts` — the audio
 * renderer will consume the same `Echo` values and make entirely different choices
 * (delay instead of appearance time, pan instead of position, timbre instead of hue).
 */

import { SPEED, type Echo } from '../echo';
import type { Material, Vec2, World } from '../world';

/**
 * Hue per material. Deliberately a narrow palette — echolocation should read as one
 * sense with texture to it, not as a color-coded map.
 */
export const MATERIAL_COLOR: Record<Material, string> = {
  metal: '#EAF6FF',
  stone: '#7FD8FF',
  water: '#5C9BFF',
  soft: '#FF9C74',
};

export type Viewport = {
  /** Screen pixels per world unit. */
  scale: number;
  /** Screen offset of the world origin. */
  ox: number;
  oy: number;
};

/** Fit an entire floor plan inside a screen rect, centered. */
export function fitViewport(world: World, width: number, height: number): Viewport {
  const scale = Math.min(width / world.size.w, height / world.size.h);
  return {
    scale,
    ox: (width - world.size.w * scale) / 2,
    oy: (height - world.size.h * scale) / 2,
  };
}

export function toScreen(p: Vec2, v: Viewport): { x: number; y: number } {
  return { x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale };
}

export function toWorld(p: Vec2, v: Viewport): Vec2 {
  return { x: (p.x - v.ox) / v.scale, y: (p.y - v.oy) / v.scale };
}

/** When this echo arrives, in milliseconds after the ping was emitted. */
export function arrivalMs(echo: Echo): number {
  return (echo.distance / SPEED) * 1000;
}

/**
 * Physical intensity is mostly bunched down at the dim end — a real ping peaks around
 * 0.3 and trails to nothing, which on screen would be a near-black picture. This lifts
 * the low end without blowing out the top, so faint distant returns stay readable.
 *
 * Purely a display decision: the audio renderer will want its own loudness curve, and
 * that is exactly why this does not live in `echo.ts`.
 */
export function displayOpacity(echo: Echo): number {
  return Math.min(1, Math.pow(echo.intensity, 0.6) * 1.05);
}

/**
 * Dots grow slightly with strength. Faint returns stay pin-sharp so a dim wall reads
 * as distant detail rather than as blur.
 */
export function dotSize(echo: Echo, v: Viewport): number {
  return (0.22 + echo.intensity * 0.42) * v.scale;
}

/**
 * How long a mark lingers. Late reverb fades faster than direct returns so the first
 * arrival is what you actually read the room from.
 */
export function fadeMs(echo: Echo): number {
  return echo.bounces === 1 ? 2200 : 1100;
}
