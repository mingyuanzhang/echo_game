import { useCallback, useEffect, useRef } from 'react';

import type { Echo } from '@/game/echo';
import {
  blipFadeMs,
  blipLength,
  blipThickness,
  egoLayout,
  INBOUND_FROM,
  INBOUND_MS,
  wavefrontMs,
  type EgoLayout,
} from '@/game/render/ego';
import { arrivalMs, displayOpacity, MATERIAL_COLOR } from '@/game/render/visual';

/**
 * Arrivals only. You are the center; everything you learn comes in from a direction at
 * a moment, and the room is never drawn. Disorienting on purpose — this is the raw
 * sense data, before any reconstruction.
 *
 * The native build gave every echo its own animated node. That does not survive the
 * move to a browser: a single call returns up to 300 echoes and two calls can be in
 * flight at once, so the same approach would put ~600 independently animating elements
 * on the page and drop frames on the exact levels where reading the room matters most.
 * So the whole field is one canvas driven by one requestAnimationFrame loop, and the
 * timing functions are evaluated by hand from the same constants the native renderer
 * animated toward. The picture is identical; only who does the interpolating changed.
 */

/** A call in flight, stamped with when it left so the loop can age it. */
export type FieldPing = {
  id: number;
  echoes: Echo[];
  /** `performance.now()` at emission. */
  startedAt: number;
};

/**
 * One arrival, with everything that does not depend on the size of the canvas worked out
 * once when the call is made rather than 60 times a second.
 *
 * The echo itself is kept because the two size helpers are functions of it *and* of the
 * layout, and the layout can change mid-flight. Pre-multiplying them against a rim of 1
 * to get pure fractions does not work: `blipThickness` floors its result at 1.5px, so a
 * unit rim comes back as the floor rather than as a fraction, and every mark is then
 * drawn a hundred times too thick.
 */
type Blip = {
  echo: Echo;
  /** When this echo becomes visible, in ms after the call. */
  start: number;
  fadeMs: number;
  peak: number;
  cos: number;
  sin: number;
  color: string;
};

const RIM_COLOR = '#12303F';
const HEADING_COLOR = '#24506B';
const BLOCKED_COLOR = '#C2453A';
const AIM_COLOR = '#1B3B52';
const SELF_COLOR = '#2B5CE6';
const WAVEFRONT_COLOR = '#4FB4E0';

/** Peak opacity of the outgoing ring, from the native renderer's fade sequence. */
const WAVEFRONT_PEAK = 0.42;
/** How long the ring takes to reach that peak before it starts dying away. */
const WAVEFRONT_ATTACK = 80;

export function EchoField({
  pings,
  heading,
  blocked,
  interactive,
  turning,
  onCall,
  onTurn,
}: {
  pings: FieldPing[];
  /** Where a step would take you. */
  heading: number;
  blocked: boolean;
  /** False while an overlay owns the screen, or once the run is over. */
  interactive: boolean;
  /** Armed for a silent turn: the next press points you instead of calling. */
  turning: boolean;
  onCall: (heading: number) => void;
  onTurn: (heading: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * Live inputs, held in refs rather than state. The loop reads them every frame, and
   * routing a pointer move through React would re-render the screen at the sampling
   * rate of the mouse to move a two-pixel line.
   */
  const pingsRef = useRef<FieldPing[]>(pings);
  const blipsRef = useRef(new Map<number, Blip[]>());
  const headingRef = useRef(heading);
  const blockedRef = useRef(blocked);
  const interactiveRef = useRef(interactive);
  const turningRef = useRef(turning);
  /**
   * Bearing to the cursor and what a press there would do, or null on touch and when
   * the pointer has left. Held together because they are drawn as one line: which of
   * the two moves you are about to make is part of where you are pointing.
   */
  const aimRef = useRef<{ bearing: number; silent: boolean } | null>(null);
  /** Canvas size in CSS pixels, and the scale its context is currently set to. */
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  headingRef.current = heading;
  blockedRef.current = blocked;
  interactiveRef.current = interactive;
  turningRef.current = turning;

  // Derive each call's blips once, and drop the derivation when the call is retired.
  if (pingsRef.current !== pings) {
    pingsRef.current = pings;
    const live = blipsRef.current;
    for (const ping of pings) {
      if (!live.has(ping.id)) live.set(ping.id, toBlips(ping.echoes));
    }
    const alive = new Set(pings.map((p) => p.id));
    for (const id of live.keys()) if (!alive.has(id)) live.delete(id);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Backing store in device pixels, drawing in CSS pixels. Without this the field is
    // a blur of soft edges on every phone and most laptops.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);

      const { w, h, dpr } = sizeRef.current;
      if (!w || !h) return;

      const layout = egoLayout(w, h);
      const now = performance.now();

      ctx.clearRect(0, 0, w, h);

      drawRim(ctx, layout);
      const aim = aimRef.current;
      if (interactiveRef.current && aim !== null) {
        drawAim(ctx, layout, aim.bearing, aim.silent);
      }
      drawHeading(ctx, layout, headingRef.current, blockedRef.current);

      for (const ping of pingsRef.current) {
        const age = now - ping.startedAt;
        drawWavefront(ctx, layout, age);
        const blips = blipsRef.current.get(ping.id);
        if (blips) drawBlips(ctx, layout, blips, age, dpr);
      }

      drawSelf(ctx, layout);
    };

    /**
     * Shift changes what a press would do, and it can be pressed while the mouse sits
     * still — so the aim line is repainted from the key as well as from the pointer.
     * Only the drawing depends on this; the press itself reads the modifier off the
     * event and is right whether or not anyone saw it coming.
     */
    const onShift = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || !aimRef.current) return;
      aimRef.current = {
        ...aimRef.current,
        silent: turningRef.current || e.type === 'keydown',
      };
    };
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
    };
  }, []);

  /** A point on screen means nothing here — only the direction it lies in. */
  const bearingTo = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return Math.atan2(
      e.clientY - rect.top - rect.height / 2,
      e.clientX - rect.left - rect.width / 2,
    );
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="field"
      aria-label="Echo field. Click in a direction to call, or hold shift to turn in silence."
      onPointerDown={(e) => {
        if (!interactiveRef.current) return;
        // Shift is the mouse's own way of asking for the quiet move, so a player who has
        // found it never has to arm the button between one turn and the next call.
        if (turningRef.current || e.shiftKey) onTurn(bearingTo(e));
        else onCall(bearingTo(e));
        // Keep the field from taking focus, so the space bar stays a step rather than
        // being swallowed as an activation of whatever was last clicked.
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        aimRef.current =
          e.pointerType === 'mouse'
            ? { bearing: bearingTo(e), silent: turningRef.current || e.shiftKey }
            : null;
      }}
      onPointerLeave={() => {
        aimRef.current = null;
      }}
    />
  );
}

function toBlips(echoes: Echo[]): Blip[] {
  return echoes.map((echo) => ({
    echo,
    start: Math.max(0, arrivalMs(echo) - INBOUND_MS),
    fadeMs: blipFadeMs(echo),
    peak: displayOpacity(echo),
    cos: Math.cos(echo.bearing),
    sin: Math.sin(echo.bearing),
    color: MATERIAL_COLOR[echo.material],
  }));
}

/** The boundary arrivals register against. Faint — it is a reference, not scenery. */
function drawRim(ctx: CanvasRenderingContext2D, layout: EgoLayout) {
  ctx.globalAlpha = 1;
  ctx.strokeStyle = RIM_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, layout.rim, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Which way a step would go. Not a sense — proprioception, the one thing you always
 * know without asking. Turns red when the last step was stopped by a wall, since
 * walking into something is information you would in fact have received.
 */
function drawHeading(
  ctx: CanvasRenderingContext2D,
  layout: EgoLayout,
  heading: number,
  blocked: boolean,
) {
  ctx.globalAlpha = 1;
  ctx.strokeStyle = blocked ? BLOCKED_COLOR : HEADING_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(layout.cx, layout.cy);
  ctx.lineTo(
    layout.cx + Math.cos(heading) * layout.rim * 0.72,
    layout.cy + Math.sin(heading) * layout.rim * 0.72,
  );
  ctx.stroke();
}

/**
 * Where a call would go if you clicked now. A mouse affords aiming before committing in
 * a way a finger never did, and a call is the expensive move — so the pointer gets to
 * show its bearing. Dashed and dimmer than the heading, because it is a proposal rather
 * than a fact about your body.
 *
 * A silent turn is proposed in the heading's own colour: what it changes is where your
 * body points, and nothing leaves you. Same dashes, since it is still only a proposal.
 */
function drawAim(
  ctx: CanvasRenderingContext2D,
  layout: EgoLayout,
  aim: number,
  silent: boolean,
) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = silent ? HEADING_COLOR : AIM_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(layout.cx, layout.cy);
  ctx.lineTo(
    layout.cx + Math.cos(aim) * layout.rim * 1.02,
    layout.cy + Math.sin(aim) * layout.rim * 1.02,
  );
  ctx.stroke();
  ctx.restore();
}

function drawSelf(ctx: CanvasRenderingContext2D, layout: EgoLayout) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = SELF_COLOR;
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, 3, 0, Math.PI * 2);
  ctx.fill();
}

/** The call leaving you, expanding at the speed echoes come back at. */
function drawWavefront(ctx: CanvasRenderingContext2D, layout: EgoLayout, age: number) {
  const duration = wavefrontMs(layout);
  if (age < 0 || age >= duration) return;

  const alpha =
    age < WAVEFRONT_ATTACK
      ? WAVEFRONT_PEAK * (age / WAVEFRONT_ATTACK)
      : WAVEFRONT_PEAK *
        (1 - easeInOutQuad((age - WAVEFRONT_ATTACK) / (duration - WAVEFRONT_ATTACK)));

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = WAVEFRONT_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, layout.maxR * (age / duration), 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * The arrivals themselves, sweeping in to the rim and landing at their bearing. Each is
 * drawn radially — pointing at where it came from — so it reads as something arriving
 * rather than as a dot sitting on a circle.
 *
 * The device-pixel transform is composed by hand per mark rather than pushed and popped
 * around a translate/rotate pair. `dpr` is the scale the caller set on the context, and
 * folding it in here is what lets several hundred rotated marks be drawn from a single
 * `setTransform` each.
 */
function drawBlips(
  ctx: CanvasRenderingContext2D,
  layout: EgoLayout,
  blips: Blip[],
  age: number,
  dpr: number,
) {
  const { cx, cy, rim } = layout;

  for (const blip of blips) {
    const dt = age - blip.start;
    if (dt < 0 || dt > INBOUND_MS + blip.fadeMs) continue;

    let alpha: number;
    if (dt < INBOUND_MS) {
      alpha = blip.peak * easeInOutQuad(dt / INBOUND_MS);
    } else {
      alpha = blip.peak * (1 - easeInOutQuad((dt - INBOUND_MS) / blip.fadeMs));
    }
    if (alpha <= 0.004) continue;

    // Approach: from just outside the rim in to the rim itself, decelerating.
    const travel = easeOutQuad(Math.min(1, dt / INBOUND_MS));
    const r = rim * (INBOUND_FROM - (INBOUND_FROM - 1) * travel);

    const length = blipLength(blip.echo, layout);
    const thickness = blipThickness(blip.echo, layout);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = blip.color;
    ctx.setTransform(
      dpr * blip.cos,
      dpr * blip.sin,
      -dpr * blip.sin,
      dpr * blip.cos,
      dpr * (cx + blip.cos * r),
      dpr * (cy + blip.sin * r),
    );
    ctx.beginPath();
    ctx.roundRect(-length / 2, -thickness / 2, length, thickness, thickness / 2);
    ctx.fill();
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
}

function easeInOutQuad(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function easeOutQuad(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) * (1 - x);
}
