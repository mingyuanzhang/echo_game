import type { RunState } from '@/game/run';

/**
 * The record of an attempt, in world coordinates: the line you walked, a ring wherever
 * you spent a call, and a marker at each end of the line.
 *
 * Shared, because the game now draws this twice for different reasons — over the true
 * floor plan when a run is over, and over nothing at all when you start a level again.
 * Keeping one drawing means the second is recognisably the first with the answer taken
 * out, rather than a different picture that happens to be about the same walk.
 */
export function RunPath({
  state,
  /** World units per CSS pixel, so markers keep a fixed size across rooms. */
  perPx,
  /** Colour of the marker where the run stopped — the one thing the two views disagree on. */
  endColor,
}: {
  state: RunState;
  perPx: number;
  endColor: string;
}) {
  return (
    <>
      <polyline
        points={state.path.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="#F5D524"
        strokeOpacity={0.85}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Where a call was made. Density here shows how much you leaned on the sense. */}
      {state.calls.map((call, i) => (
        <circle
          key={i}
          cx={call.at.x}
          cy={call.at.y}
          r={7 * perPx}
          fill="none"
          stroke="#4FB4E0"
          strokeOpacity={0.55}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <circle cx={state.path[0].x} cy={state.path[0].y} r={4.5 * perPx} fill="#2B5CE6" />
      <circle cx={state.pos.x} cy={state.pos.y} r={4.5 * perPx} fill={endColor} />
    </>
  );
}
