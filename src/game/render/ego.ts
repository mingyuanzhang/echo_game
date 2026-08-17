/**
 * The egocentric presentation: what arrives at the listener, rather than where it came
 * from. Nothing here plots a reflection point, because a bat never receives one — it
 * receives a bearing, a delay and a loudness, and the room is inferred from those.
 *
 * This is the closer ancestor of the audio renderer. Bearing becomes pan, arrival time
 * stays arrival time, intensity becomes gain. Only the medium changes.
 */

import { SPEED, type Echo } from '../echo';

export type EgoLayout = {
  cx: number;
  cy: number;
  /** Radius at which arrivals register — the edge of "you". */
  rim: number;
  /** Far enough to leave the screen. */
  maxR: number;
  /** Screen pixels per world unit, derived so the wavefront and arrivals agree. */
  pxPerUnit: number;
};

/** How long the outgoing wavefront takes to cross the screen. Pure feel. */
const WAVEFRONT_SECONDS = 1.3;

export function egoLayout(width: number, height: number): EgoLayout {
  const maxR = Math.hypot(width, height) / 2;
  return {
    cx: width / 2,
    cy: height / 2,
    rim: Math.min(width, height) * 0.33,
    maxR,
    pxPerUnit: maxR / (SPEED * WAVEFRONT_SECONDS),
  };
}

/** Duration of the outgoing ring's expansion, in ms. */
export function wavefrontMs(layout: EgoLayout): number {
  return (layout.maxR / (SPEED * layout.pxPerUnit)) * 1000;
}

/**
 * How long before arrival an echo becomes visible, sweeping inward to the rim. This is
 * an affordance, not distance — it deliberately starts just outside the rim so the
 * approach conveys motion without smuggling range back into the picture.
 */
export const INBOUND_MS = 240;

/** Radius the blip starts from, as a multiple of the rim. */
export const INBOUND_FROM = 1.34;

/** Radial length of an arrival mark. Louder returns read as longer streaks. */
export function blipLength(echo: Echo, layout: EgoLayout): number {
  return layout.rim * (0.1 + echo.intensity * 0.3);
}

export function blipThickness(echo: Echo, layout: EgoLayout): number {
  return Math.max(1.5, layout.rim * (0.012 + echo.intensity * 0.03));
}

/** Late reverb decays faster, so the first arrivals dominate what you read. */
export function blipFadeMs(echo: Echo): number {
  return echo.bounces === 1 ? 900 : 520;
}
