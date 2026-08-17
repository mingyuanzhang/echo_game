/**
 * Headless smoke test: does every screen render, and does a call still return sound?
 *
 *   npm run smoke
 *
 * No substitute for looking at the thing, but it catches a crash in any screen — the
 * debrief and the end card are otherwise several minutes of play away from being seen.
 */

import { renderToStaticMarkup } from 'react-dom/server';

import { BEAM, emit, pingDuration } from '../src/game/echo';
import { LEVELS } from '../src/game/levels';
import { grade, initialRun, runReducer, scoreRun } from '../src/game/run';
import { AllClear } from '../src/ui/AllClear';
import { App } from '../src/ui/App';
import { ProgressPage } from '../src/ui/ProgressPage';
import { RoomPreview } from '../src/ui/RoomPreview';
import { RunSummary } from '../src/ui/RunSummary';

// Progress is read synchronously during the first render, so there has to be somewhere
// to read it from before anything mounts.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
});

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// --- The sense -------------------------------------------------------------

const level = LEVELS[0];
const echoes = emit(level.world, level.start, level.startHeading, BEAM);

check('a call returns echoes', echoes.length > 0, `${echoes.length} arrivals`);
check(
  'intensities stay in range',
  echoes.every((e) => e.intensity > 0 && e.intensity <= 1),
);
check(
  'bearings are radians',
  echoes.every((e) => Math.abs(e.bearing) <= Math.PI + 1e-9),
);
check(
  'a ping has a duration',
  pingDuration(echoes) > 0,
  `${Math.round(pingDuration(echoes))}ms`,
);
check(
  'a wider call lights more surfaces',
  emit(level.world, level.start, 0, { ...BEAM, spread: Math.PI * 2, taper: 0 }).length >
    echoes.length,
);

// --- The rules -------------------------------------------------------------

let run = initialRun(level);
run = runReducer(run, { type: 'CALL', heading: 0 });
check('calling costs a call and sets the heading', run.pings === 1 && run.heading === 0);

run = runReducer(run, { type: 'STEP' });
check('stepping costs a move and extends the path', run.moves === 1 && run.path.length === 2);
check('giving up scores nothing', scoreRun(runReducer(run, { type: 'GIVE_UP' })) === 0);
check('a score of zero has no grade', grade(0) === '—');

// --- The screens -----------------------------------------------------------

const escaped = { ...initialRun(level), status: 'escaped' as const, pings: 1, moves: 8 };

const screens: [string, () => string][] = [
  ['the game', () => renderToStaticMarkup(<App />)],
  [
    'the debrief',
    () =>
      renderToStaticMarkup(
        <RunSummary state={escaped} onRestart={() => {}} onNext={() => {}} />,
      ),
  ],
  ['the plan', () => renderToStaticMarkup(<RoomPreview level={level} onBegin={() => {}} />)],
  [
    'the record',
    () =>
      renderToStaticMarkup(
        <ProgressPage
          progress={{
            level: 3,
            easy: true,
            results: { [level.id]: { score: 940, pings: 1, moves: 9 } },
          }}
          current={3}
          onEasyChange={() => {}}
          onClose={() => {}}
        />,
      ),
  ],
  [
    'the end',
    () =>
      renderToStaticMarkup(
        <AllClear levels={LEVELS.length} onProgress={() => {}} onAgain={() => {}} />,
      ),
  ],
];

for (const [name, render] of screens) {
  try {
    const html = render();
    check(`${name} renders`, html.length > 0, `${html.length} bytes`);
  } catch (e) {
    check(`${name} renders`, false, String(e));
  }
}

try {
  const plans = LEVELS.map((l) => renderToStaticMarkup(<RoomPreview level={l} onBegin={() => {}} />));
  check(
    `all ${LEVELS.length} floor plans draw`,
    plans.every((html) => html.includes('<svg')),
  );
} catch (e) {
  check(`all ${LEVELS.length} floor plans draw`, false, String(e));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall smoke checks passed');
process.exit(failures ? 1 : 0);
