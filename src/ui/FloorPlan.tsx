import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { MATERIAL_COLOR } from '@/game/render/visual';
import type { Vec2, World } from '@/game/world';

/**
 * The room, drawn honestly. This is the one view in the game that does not lie, which
 * is why it exists in exactly one place: the debrief and the easy-mode preview must
 * agree about what a wall looks like, or studying a plan would teach you to read a
 * picture you are never shown again.
 *
 * Drawn as an SVG in world coordinates. The native build placed and rotated a div per
 * wall because it had no other primitive; a browser has one, and a `viewBox` matching
 * the world does the fitting that `fitViewport` used to do by hand.
 *
 * Sizing comes from the level rather than the screen — rooms differ in shape, so the
 * plan takes its aspect ratio from the world and lets the caller decide how much width
 * to give it.
 */
export function FloorPlan({
  world,
  exit,
  wallOpacity = 0.5,
  className,
  children,
}: {
  world: World;
  /** Drawn last, so it stays legible over whatever the caller puts inside. */
  exit?: { a: Vec2; b: Vec2 };
  wallOpacity?: number;
  className?: string;
  /**
   * Anything drawn in world coordinates on top of the walls — paths, markers, calls.
   * Handed the number of world units one CSS pixel covers, so a mark that should be a
   * fixed size on screen can stay one across rooms of very different scales.
   */
  children?: (perPx: number) => ReactNode;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [perPx, setPerPx] = useState(0);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    // Whichever axis the fit is constrained on. The element is given the world's aspect
    // ratio, but a caller's `max-height` can still letterbox it, and then width alone
    // would overstate the scale and shrink every mark drawn on top.
    setPerPx(Math.max(world.size.w / width, world.size.h / height));
  }, [world.size.h, world.size.w]);

  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <svg
      ref={ref}
      className={className}
      viewBox={`0 0 ${world.size.w} ${world.size.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${world.size.w} / ${world.size.h}` }}
      role="img"
      aria-label="Floor plan of the room">
      <g strokeLinecap="square" vectorEffect="non-scaling-stroke">
        {world.walls.map((seg, i) => (
          <line
            key={i}
            x1={seg.a.x}
            y1={seg.a.y}
            x2={seg.b.x}
            y2={seg.b.y}
            stroke={MATERIAL_COLOR[seg.material]}
            strokeOpacity={wallOpacity}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>

      {perPx > 0 && children?.(perPx)}

      {exit && (
        <line
          x1={exit.a.x}
          y1={exit.a.y}
          x2={exit.b.x}
          y2={exit.b.y}
          stroke="#3ED598"
          strokeOpacity={0.9}
          strokeWidth={3}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
