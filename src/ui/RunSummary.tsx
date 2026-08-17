import { FloorPlan } from '@/ui/FloorPlan';
import { grade, scoreRun, type RunState } from '@/game/run';

/**
 * The debrief — and, easy mode aside, the only time the room is drawn honestly. Seeing
 * the true shape against the path you actually walked is the whole payoff: it shows you
 * what you had inferred, and where you were wrong.
 *
 * Which is why this screen is only reached by ending a run, and past the opening levels
 * a run can only end by getting out. Starting a level over shows you nothing.
 */
export function RunSummary({
  state,
  onRestart,
  onNext,
  nextLabel = 'NEXT',
}: {
  state: RunState;
  onRestart: () => void;
  onNext?: () => void;
  nextLabel?: string;
}) {
  const escaped = state.status === 'escaped';
  const score = scoreRun(state);

  return (
    <div className="overlay overlay--sheet">
      <h2 className={`overlay__title ${escaped ? 'is-good' : 'is-bad'}`}>
        {escaped ? 'OUT' : 'GAVE UP'}
      </h2>

      <FloorPlan world={state.level.world} exit={state.level.exit} className="plan">
        {(perPx) => (
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
            <circle
              cx={state.pos.x}
              cy={state.pos.y}
              r={4.5 * perPx}
              fill={escaped ? '#3ED598' : '#C2453A'}
            />
          </>
        )}
      </FloorPlan>

      <div className="stats">
        <Stat label="CALLS" value={state.pings} best={state.level.best.pings} />
        <Stat label="MOVES" value={state.moves} best={state.level.best.moves} />
      </div>

      <div className="score-block">
        <div className="score">{score}</div>
        <div className={`grade ${escaped ? 'is-good' : 'is-bad'}`}>{grade(score)}</div>
      </div>

      <div className="actions">
        <button type="button" className="btn" onClick={onRestart}>
          TRY AGAIN
        </button>
        {onNext && (
          <button
            type="button"
            className={`btn ${escaped ? 'btn--primary' : ''}`}
            onClick={onNext}>
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, best }: { label: string; value: number; best: number }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className={`stat__value ${value > best ? 'is-over' : ''}`}>{value}</div>
      <div className="stat__par">best {best}</div>
    </div>
  );
}
