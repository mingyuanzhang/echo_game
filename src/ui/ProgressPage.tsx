import { LEVELS } from '@/game/levels';
import type { LevelResult, Progress } from '@/game/progress';
import { grade } from '@/game/run';

/**
 * The record. Every room you have got out of, what it cost, and what it should have
 * cost — the par figures are the whole point of showing this, since a score on its own
 * is a number with nothing to be a number *of*.
 *
 * Only escapes are recorded, and only your best one per room. Giving up is not a
 * performance, and a bad run should not overwrite a good one.
 */
export function ProgressPage({
  progress,
  current,
  onEasyChange,
  onClose,
}: {
  progress: Progress;
  /** Index of the level in play, marked so the list has a "you are here". */
  current: number;
  onEasyChange: (easy: boolean) => void;
  onClose: () => void;
}) {
  const cleared = LEVELS.filter((level) => progress.results[level.id]).length;
  const total = LEVELS.reduce(
    (sum, level) => sum + (progress.results[level.id]?.score ?? 0),
    0,
  );

  return (
    <div className="overlay overlay--solid record">
      <header className="record__header">
        <h2 className="overlay__heading">PROGRESS</h2>
        <div className="record__totals">
          <Total label="ESCAPED" value={`${cleared} / ${LEVELS.length}`} />
          <Total label="TOTAL" value={grouped(total)} />
        </div>
      </header>

      <ol className="record__list">
        {LEVELS.map((level, i) => (
          <Row
            key={level.id}
            index={i}
            name={level.name}
            best={level.best}
            result={progress.results[level.id]}
            current={i === current}
          />
        ))}
      </ol>

      <footer className="record__footer">
        <label className="easy">
          <span className="easy__text">
            <span className="easy__label">EASY MODE</span>
            <span className="easy__hint">See the floor plan before each room begins.</span>
          </span>
          <input
            type="checkbox"
            className="switch"
            role="switch"
            checked={progress.easy}
            onChange={(e) => onEasyChange(e.target.checked)}
          />
        </label>

        <button type="button" className="btn btn--block" onClick={onClose} autoFocus>
          BACK
        </button>
      </footer>
    </div>
  );
}

function Row({
  index,
  name,
  best,
  result,
  current,
}: {
  index: number;
  name: string;
  best: { pings: number; moves: number };
  result?: LevelResult;
  current: boolean;
}) {
  return (
    <li className={`row ${current ? 'row--current' : ''}`}>
      <span className="row__index">{String(index + 1).padStart(2, '0')}</span>

      <span className="row__middle">
        <span className={`row__name ${result ? '' : 'is-unplayed'}`}>{name}</span>
        <span className="row__detail">
          {result
            ? `${result.pings} calls · ${result.moves} moves`
            : `par ${best.pings} calls · ${best.moves} moves`}
        </span>
      </span>

      {result ? (
        <span className="row__right">
          <span className="row__score">{result.score}</span>
          <span
            className="row__grade"
            style={{ color: GRADE_COLOR[grade(result.score)] ?? '#5A6672' }}>
            {grade(result.score)}
          </span>
        </span>
      ) : (
        <span className="row__pending">—</span>
      )}
    </li>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="total__label">{label}</div>
      <div className="total__value">{value}</div>
    </div>
  );
}

/** Thousands separators, without leaning on an Intl build that may not be there. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const GRADE_COLOR: Record<string, string> = {
  FLAWLESS: '#3ED598',
  SHARP: '#9FD9F5',
  CAPABLE: '#6E93A8',
  CLUMSY: '#F5A524',
  LOST: '#C2453A',
};
