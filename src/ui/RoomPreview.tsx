import type { Level } from '@/game/levels';
import { FloorPlan } from '@/ui/FloorPlan';

/**
 * Easy mode: the plan, before you go in. The shape and the doorway, and deliberately
 * nothing else — no start marker, no heading, no scale you could measure yourself
 * against. Knowing a room is an L with the way out at the far end still leaves the hard
 * question open, which is where in it you are, and that is the question the sense
 * actually answers.
 *
 * So this makes the game easier without making it a different game: it converts blind
 * exploration into orientation, which is the part worth practising anyway.
 */
export function RoomPreview({ level, onBegin }: { level: Level; onBegin: () => void }) {
  return (
    <div className="overlay overlay--sheet">
      <h2 className="overlay__heading">THE PLAN</h2>

      <FloorPlan world={level.world} exit={level.exit} wallOpacity={0.72} className="plan" />

      <p className="overlay__line">You are somewhere inside. That part you work out yourself.</p>

      <button type="button" className="btn btn--primary" onClick={onBegin} autoFocus>
        GO IN
      </button>
    </div>
  );
}
