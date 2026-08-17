import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { BEAM, emit, pingDuration } from '@/game/echo';
import { LEVELS, MERCY_LEVELS } from '@/game/levels';
import { loadProgress, saveProgress, type Progress } from '@/game/progress';
import { initialRun, runReducer, scoreRun } from '@/game/run';
import { AllClear } from '@/ui/AllClear';
import { EchoField, type FieldPing } from '@/ui/EchoField';
import { PathReview } from '@/ui/PathReview';
import { ProgressPage } from '@/ui/ProgressPage';
import { RoomPreview } from '@/ui/RoomPreview';
import { RunSummary } from '@/ui/RunSummary';

/** Older calls are dropped rather than layered indefinitely. */
const MAX_PINGS = 2;

/**
 * The game. You never see the room while playing — only what comes back. A call sets
 * your heading and costs you; stepping is free of sound but blind, so the cheapest
 * escape is the one where you trust a single call for several moves.
 */
export function App() {
  // Read from storage once, on the first render. It is a synchronous read, so the right
  // room is up before the first frame and there is no flicker of level one on the way
  // to wherever the player actually left off.
  const [progress, setProgress] = useState<Progress>(() => loadProgress(LEVELS.length));
  const [state, dispatch] = useReducer(runReducer, progress.level, (level) =>
    initialRun(LEVELS[level]),
  );

  const [pings, setPings] = useState<FieldPing[]>([]);
  /** Set once the last door is behind you, and the only thing left is the last screen. */
  const [finished, setFinished] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  /** Easy mode, mid-look: the plan is up and the room has not started yet. */
  const [studying, setStudying] = useState(progress.easy);
  /**
   * Restart, asked for but not yet done: the attempt is frozen and its path is on screen.
   * The run itself is untouched while this is up, so the review can read straight from
   * `state` — which is also what stops it going stale if anything else were to fire.
   */
  const [reviewing, setReviewing] = useState(false);
  /**
   * Armed for a silent turn: the next press on the field points you instead of calling.
   * A one-shot rather than a mode, so there is never a state you can be stuck in and not
   * notice — the field is blank either way, and a call you meant to make coming out as a
   * silent pivot would read as the game ignoring you.
   */
  const [turning, setTurning] = useState(false);

  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  /**
   * The saved record, readable from callbacks without making every one of them depend
   * on it. Progress is written far more often than it is read back, and threading it
   * through the dependency arrays would rebuild half the screen's handlers on every
   * escape.
   */
  const saved = useRef(progress);

  const update = useCallback((patch: Partial<Progress>) => {
    const next = { ...saved.current, ...patch };
    saved.current = next;
    setProgress(next);
    saveProgress(next);
  }, []);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /**
   * Record the run, if it was an escape and if it beat what was there. Kept as an effect
   * rather than folded into the step handler because escaping is something the reducer
   * decides, not something the button knows it is about to cause.
   */
  useEffect(() => {
    if (state.status !== 'escaped') return;
    const score = scoreRun(state);
    const previous = saved.current.results[state.level.id];
    if (previous && previous.score >= score) return;
    update({
      results: {
        ...saved.current.results,
        [state.level.id]: { score, pings: state.pings, moves: state.moves },
      },
    });
  }, [state, update]);

  const playing = state.status === 'playing';
  const levelIndex = LEVELS.findIndex((l) => l.id === state.level.id);
  const lastLevel = levelIndex === LEVELS.length - 1;

  /** Nothing is in the way of the field, so a press on it is a call or a turn. */
  const fieldLive = playing && !studying && !showProgress && !finished && !reviewing;

  /** Pointing picks a direction — there is no map on screen, so a point means nothing. */
  const onCall = useCallback(
    (heading: number) => {
      if (state.status !== 'playing') return;

      const echoes = emit(state.level.world, state.pos, heading, BEAM);
      const ping: FieldPing = { id: nextId.current++, echoes, startedAt: performance.now() };
      setPings((prev) => [...prev, ping].slice(-MAX_PINGS));

      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setPings((prev) => prev.filter((p) => p.id !== ping.id));
      }, pingDuration(echoes) + 1800);
      timers.current.add(timer);

      dispatch({ type: 'CALL', heading });
      setTurning(false);
    },
    [state.level.world, state.pos, state.status],
  );

  /**
   * Turning costs nothing and returns nothing. Sound already in flight is left alone —
   * unlike a step, a pivot does not move the ear those echoes were measured from, so
   * they go on being true while you decide where to walk.
   */
  const onTurn = useCallback((heading: number) => {
    dispatch({ type: 'TURN', heading });
    setTurning(false);
  }, []);

  /**
   * Stepping discards any sound still in flight. Those echoes were measured from where
   * you were standing, and keeping them on screen would quietly lie about where you are.
   */
  const onStep = useCallback(() => {
    clearTimers();
    setPings([]);
    setTurning(false);
    dispatch({ type: 'STEP' });
  }, [clearTimers]);

  const restartNow = useCallback(() => {
    clearTimers();
    setPings([]);
    setReviewing(false);
    setTurning(false);
    setStudying(saved.current.easy);
    dispatch({ type: 'RESTART' });
  }, [clearTimers]);

  /**
   * Starting over from inside a run costs you the attempt but shows you the walk first —
   * your line and your calls, drawn over a blank plan. It is feedback that cannot spoil
   * the room, so it can be given away for free, unlike the debrief.
   *
   * Skipped when there is nothing to look at: a run with no calls and no steps has no
   * path, and a blank sheet between the button and the fresh room is just an obstacle.
   * Skipped too once the run has ended, since the debrief has already shown all of this
   * and the room besides.
   */
  const onRestart = useCallback(() => {
    if (state.status !== 'playing' || (state.pings === 0 && state.moves === 0)) {
      restartNow();
      return;
    }
    clearTimers();
    setPings([]);
    setReviewing(true);
  }, [clearTimers, restartNow, state.moves, state.pings, state.status]);

  const loadLevel = useCallback(
    (index: number) => {
      const level = LEVELS[index];
      if (!level) return;
      clearTimers();
      setPings([]);
      setReviewing(false);
      setTurning(false);
      // Written on arrival rather than on completion, so leaving the page halfway
      // through a room puts you back in that room and not the one before it.
      update({ level: index });
      setStudying(saved.current.easy);
      dispatch({ type: 'LOAD', level });
    },
    [clearTimers, update],
  );

  /**
   * On to the next room, or to the end of the game. Deliberately shared between NEXT on
   * the debrief and SKIP during play: the difference between finishing a level and
   * abandoning it is which screen you were looking at, not where you end up.
   */
  const advance = useCallback(
    () => (lastLevel ? setFinished(true) : loadLevel(levelIndex + 1)),
    [lastLevel, levelIndex, loadLevel],
  );

  /**
   * Quitting is a tutorial affordance. In the opening levels being shown the room you
   * failed to read is the lesson, so surrender is offered and costs only the score;
   * after that the only way out is out, and the map is what you get for finding it.
   */
  const canGiveUp = levelIndex < MERCY_LEVELS;

  /**
   * Switching easy mode on shows the plan straight away, but only if the room has not
   * started — mid-run it would be a different feature entirely, and one that undoes the
   * level you are halfway through.
   */
  const onEasyChange = (easy: boolean) => {
    update({ easy });
    setStudying(easy && playing && state.pings === 0 && state.moves === 0);
  };

  /**
   * The keyboard. A mouse can aim a call but has nothing spare to walk with, and a step
   * is the move you make several times per call — so the space bar carries it, and the
   * rest of the keys follow whatever is currently on screen rather than meaning one
   * fixed thing. Every branch calls `preventDefault`: space would otherwise scroll the
   * page, and both space and enter would otherwise re-activate whichever button was
   * last clicked, firing the action twice.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        if (showProgress) setShowProgress(false);
        else if (!finished) setShowProgress(true);
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        // A focused control inside the record owns its own keys. The rows are buttons
        // now, and swallowing enter here would make the list unreachable from the
        // keyboard — every row would close the page instead of opening the room.
        if (e.target instanceof HTMLElement && e.target.closest('.record')) return;

        e.preventDefault();
        if (showProgress) setShowProgress(false);
        else if (reviewing) restartNow();
        else if (finished) return;
        else if (studying && playing) setStudying(false);
        else if (!playing) advance();
        else onStep();
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        if (showProgress || finished || studying) return;
        e.preventDefault();
        // A second press confirms the first: R puts the path up, R again goes back in.
        if (reviewing) restartNow();
        else onRestart();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    advance,
    finished,
    onRestart,
    onStep,
    playing,
    restartNow,
    reviewing,
    showProgress,
    studying,
  ]);

  return (
    <div className="app">
      <div className="shell">
        <header className="hud">
          <button type="button" className="hud__level" onClick={() => setShowProgress(true)}>
            <span className="hud__count-row">
              <span className="hud__count">
                {levelIndex + 1} / {LEVELS.length}
              </span>
              <span className="hud__link">PROGRESS</span>
            </span>
            <span className="hud__name">{state.level.name}</span>
          </button>

          <div className="hud__counters">
            <Counter label="CALLS" value={state.pings} />
            <Counter label="MOVES" value={state.moves} />
          </div>
        </header>

        <main className="field-wrap">
          <EchoField
            pings={pings}
            heading={state.heading}
            blocked={state.blocked}
            interactive={fieldLive}
            turning={turning}
            onCall={onCall}
            onTurn={onTurn}
          />
        </main>

        <footer className="footer">
          <p className={`hint ${turning ? 'is-turning' : ''}`}>
            {turning ? (
              <>
                <span className="only-touch">tap a direction to face it — no sound</span>
                <span className="only-pointer">click a direction to face it — no sound</span>
              </>
            ) : state.blocked ? (
              'something solid — you stopped short'
            ) : (
              <>
                <span className="only-touch">tap to call in a direction</span>
                <span className="only-pointer">click to call in a direction</span>
              </>
            )}
          </p>

          <div className="buttons">
            <button
              type="button"
              className="btn btn--accent"
              onClick={onStep}
              disabled={!playing}>
              STEP
            </button>
            {/* Free, and free of information. Lights up while it is armed, because an
                armed field looks exactly like an unarmed one. */}
            <button
              type="button"
              className={`btn ${turning ? 'btn--armed' : 'btn--dim'}`}
              aria-pressed={turning}
              onClick={() => setTurning((on) => !on)}
              disabled={!playing}>
              TURN
            </button>
            {canGiveUp ? (
              <button
                type="button"
                className="btn btn--dim"
                onClick={() => dispatch({ type: 'GIVE_UP' })}
                disabled={!playing}>
                GIVE UP
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--dim"
                onClick={onRestart}
                disabled={!playing}>
                RESTART
              </button>
            )}
            {/* Leaves without a debrief, which is the whole difference from giving up:
                the floor plan stays unseen, so skipping costs you the answer as well. */}
            <button type="button" className="btn btn--dim" onClick={advance}>
              SKIP
            </button>
          </div>

          <p className="keys only-pointer">
            <kbd>space</kbd> step <span className="keys__sep">·</span> <kbd>shift</kbd>+click
            turn <span className="keys__sep">·</span> <kbd>R</kbd> restart{' '}
            <span className="keys__sep">·</span> <kbd>esc</kbd> progress
          </p>
        </footer>
      </div>

      {studying && playing && (
        <RoomPreview level={state.level} onBegin={() => setStudying(false)} />
      )}

      {/* The walk without the room, on the way back to the start of the same level. */}
      {reviewing && playing && <PathReview state={state} onRestart={restartNow} />}

      {!playing && !finished && (
        <RunSummary
          state={state}
          onRestart={restartNow}
          onNext={advance}
          nextLabel={lastLevel ? 'FINISH' : 'NEXT'}
        />
      )}

      {finished && (
        <AllClear
          levels={LEVELS.length}
          onProgress={() => setShowProgress(true)}
          onAgain={() => {
            setFinished(false);
            loadLevel(0);
          }}
        />
      )}

      {/* Last, so it covers the debrief and the end screen as well as the game. */}
      {showProgress && (
        <ProgressPage
          progress={progress}
          current={levelIndex}
          onEasyChange={onEasyChange}
          onSelect={(index) => {
            // Also the way back from the end screen, which is otherwise a dead end with
            // one button on it.
            setFinished(false);
            loadLevel(index);
            setShowProgress(false);
          }}
          onClose={() => setShowProgress(false)}
        />
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="counter">
      <div className="counter__label">{label}</div>
      <div className="counter__value">{value}</div>
    </div>
  );
}
