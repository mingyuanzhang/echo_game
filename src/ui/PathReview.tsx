import { FloorPlan } from '@/ui/FloorPlan';
import { RunPath } from '@/ui/RunPath';
import type { RunState } from '@/game/run';

/**
 * What starting over is worth: the walk, and nothing under it. You see that you swept
 * the same corner three times, or that four calls went into one doorway — the shape of
 * your own searching, which is a thing you cannot see from inside it and which is easy
 * to repeat exactly on the next attempt.
 *
 * What you do not get is the room. That is the difference between this and the debrief,
 * and it is the whole point: the answer is still the reward for getting out (or, in the
 * opening levels, for admitting you cannot). Restarting is free of that price and free
 * of that gift.
 *
 * The plan keeps the room's true frame and scale even with the walls withheld, so the
 * line sits where it really ran. Only the aspect ratio leaks, which the field already
 * tells you anyway.
 */
export function PathReview({ state, onRestart }: { state: RunState; onRestart: () => void }) {
  return (
    <div className="overlay overlay--sheet">
      <h2 className="overlay__heading">WHERE YOU WENT</h2>

      <FloorPlan world={state.level.world} wallOpacity={0} className="plan">
        {(perPx) => <RunPath state={state} perPx={perPx} endColor="#C7D3DC" />}
      </FloorPlan>

      <p className="overlay__line">
        Your line and your calls. The room is still yours to work out.
      </p>

      <button type="button" className="btn btn--primary" onClick={onRestart} autoFocus>
        START OVER
      </button>
    </div>
  );
}
