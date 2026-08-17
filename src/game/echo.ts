/**
 * Echolocation as a pure projection of the world. No React, no rendering, no colors —
 * `emit` returns physical facts about returning sound, and a renderer decides whether
 * those become dots on a screen or delayed taps in a pair of headphones.
 *
 * That split is deliberate: the audio version is meant to consume exactly this data.
 */

import { castRay, EPSILON } from './geometry';
import { REFLECTIVITY, type Material, type Vec2, type World } from './world';

export type Echo = {
  /** Where the sound reflected, in world coordinates. */
  point: Vec2;
  /** Round-trip path length. Divided by SPEED this is when the echo arrives. */
  distance: number;
  /** 0..1 after incidence, absorption and spreading loss. */
  intensity: number;
  /** Radians from the listener to the reflection point. Becomes stereo pan. */
  bearing: number;
  material: Material;
  /** 1 is a direct return; higher is reverb arriving late and faint. */
  bounces: number;
};

export type Ping = {
  id: number;
  origin: Vec2;
  echoes: Echo[];
};

export type PingOptions = {
  /** Angular resolution. More rays means a denser picture for the same energy. */
  rays: number;
  /** Full width of the cone, in radians. */
  spread: number;
  /** Emitted energy, spread across the cone. */
  power: number;
  /**
   * Directivity of the main lobe. 0 emits uniformly in every direction the cone covers;
   * higher values concentrate energy on axis and let it fall away toward the edges, the
   * way an actual call does. A tapered beam is what makes "what am I aimed at" a sharp
   * question — with uniform energy the whole cone answers equally and nothing stands out.
   */
  taper: number;
  maxBounces: number;
  /**
   * Hard ceiling on returned echoes, keeping the strongest. Every echo becomes a node
   * on screen (and later a scheduled sound), so this bounds render cost regardless of
   * how reverberant the geometry turns out to be.
   */
  maxEchoes: number;
};

/**
 * World units per second. Real sound would cross this chamber in under a fifth of a
 * second, which is far too fast to read — so this is a game constant, tuned for
 * legibility. Both renderers must share it or the visuals and audio would disagree.
 */
export const SPEED = 42;

/**
 * Atmospheric absorption: the medium itself swallows sound over distance. Exponential,
 * and severe for ultrasound in air — a real reason bats work at short range.
 */
const RANGE = 170;

/**
 * Geometric spreading, the other half of the loss. Sound radiates over an expanding
 * wavefront on the way out, and the reflection spreads again on the way back. For an
 * extended flat surface the two legs combine to an inverse square law — the echo
 * behaves as though it came from an image source at twice the distance.
 *
 * Absorption alone (which is all this had) makes distant surfaces far too legible.
 */
const SPREADING = 2;

/**
 * Round-trip distance inside which spreading is not applied, so returns from right
 * beside you do not blow up toward infinity.
 */
const NEAR_FIELD = 14;

/**
 * How sharply return strength falls off away from head-on. Higher means only surfaces
 * nearly perpendicular to the ray answer at all. This exponent is the single biggest
 * lever on whether the result feels like echolocation or like a torch beam.
 */
const INCIDENCE = 2.2;

/** Below this, an echo is not worth carrying to a renderer. */
const MIN_INTENSITY = 0.02;

/**
 * Later bounces must clear a higher bar than direct returns. Without this, faint
 * third-bounce reverb dominated the output — hundreds of dim marks that added a long
 * tail and told you nothing about the room's shape.
 */
const BOUNCE_FLOOR = [0, 1, 2.4, 5];

/**
 * Cast a fan of rays and collect what comes back.
 *
 * The model is retroreflective: energy returns along the path it arrived on, which is
 * why the incidence term dominates. A wall square-on answers loudly; the same wall at
 * a glancing angle throws its energy off into the room and answers with almost
 * nothing. Later bounces approximate their return along the reflected path, which is
 * wrong in detail but reads correctly as a faint, late reverb tail.
 */
export function emit(
  world: World,
  origin: Vec2,
  facing: number,
  opts: PingOptions,
): Echo[] {
  const { rays, spread, power, taper, maxBounces } = opts;
  const echoes: Echo[] = [];
  const halfSpread = spread / 2;

  for (let i = 0; i < rays; i++) {
    const offAxis = -halfSpread + (spread * (i + 0.5)) / rays;
    const angle = facing + offAxis;

    // Beam pattern. `power` is calibrated as the on-axis strength of a perfect head-on
    // return at zero range, so it still reads directly as peak intensity; rays away
    // from the axis leave with progressively less to spend.
    const gain =
      taper > 0
        ? Math.pow(Math.max(0, Math.cos((offAxis / halfSpread) * (Math.PI / 2))), taper)
        : 1;

    let dir = { x: Math.cos(angle), y: Math.sin(angle) };
    let pos = origin;
    let energy = power * gain;
    let travelled = 0;

    if (energy < MIN_INTENSITY) continue;

    for (let bounce = 1; bounce <= maxBounces; bounce++) {
      // A ray that hits nothing has escaped — through a doorway, most likely. That
      // silence is information: an opening is a direction that does not answer.
      const hit = castRay(world.walls, pos, dir);
      if (!hit) break;

      travelled += hit.t;
      const roundTrip = travelled * 2;

      const incidence = Math.abs(dir.x * hit.normal.x + dir.y * hit.normal.y);
      const reflectivity = REFLECTIVITY[hit.material];
      const spreading = Math.pow(
        NEAR_FIELD / Math.max(NEAR_FIELD, roundTrip),
        SPREADING,
      );
      const intensity =
        energy *
        reflectivity *
        Math.pow(incidence, INCIDENCE) *
        spreading *
        Math.exp(-roundTrip / RANGE);

      const floor = MIN_INTENSITY * BOUNCE_FLOOR[Math.min(bounce, 3)];
      if (intensity >= floor) {
        echoes.push({
          point: hit.point,
          distance: roundTrip,
          intensity: Math.min(1, intensity),
          bearing: Math.atan2(hit.point.y - origin.y, hit.point.x - origin.x),
          material: hit.material,
          bounces: bounce,
        });
      }

      // Whatever was not absorbed carries on as a specular reflection.
      energy *= reflectivity;
      if (energy < MIN_INTENSITY) break;

      const dot = dir.x * hit.normal.x + dir.y * hit.normal.y;
      dir = { x: dir.x - 2 * dot * hit.normal.x, y: dir.y - 2 * dot * hit.normal.y };
      pos = {
        x: hit.point.x + dir.x * EPSILON * 10,
        y: hit.point.y + dir.y * EPSILON * 10,
      };
    }
  }

  if (echoes.length <= opts.maxEchoes) return echoes;
  return echoes.sort((a, b) => b.intensity - a.intensity).slice(0, opts.maxEchoes);
}

/**
 * A bat's call: a narrow, strongly directional beam, roughly 26 degrees wide with the
 * energy piled on the axis. Narrow enough that an opening reads as total silence rather
 * than as a dip among louder neighbours — with a wide cone, returns from the rest of the
 * beam land on adjacent bearings and drown the gap out.
 */
export const BEAM: PingOptions = {
  // Ray count scaled with the cone so angular resolution stays about 4 rays per degree.
  rays: 200,
  spread: Math.PI / 4,
  power: 1,
  taper: 2.2,
  // Measured: a third bounce never survives BOUNCE_FLOOR here, so casting one is
  // wasted work. Raise this again only alongside a lower floor.
  maxBounces: 2,
  // Raised with the cone: a wider call lights more surfaces, and the cap culls by
  // intensity, which would otherwise discard the dim distant returns first.
  maxEchoes: 300,
};

/** A wide, undirected call — the shape of the room at once, with no axis to speak of. */
export const OMNI: PingOptions = {
  rays: 340,
  spread: Math.PI * 2,
  power: 0.85,
  taper: 0,
  maxBounces: 2,
  maxEchoes: 340,
};

/** When the last echo of a ping has arrived, in milliseconds. */
export function pingDuration(echoes: Echo[]): number {
  let max = 0;
  for (const e of echoes) max = Math.max(max, e.distance);
  return (max / SPEED) * 1000;
}
