/**
 * Everything the game remembers between visits: where you got to, how well each room
 * went, and whether you want to see the plan first. One small JSON blob — the game has
 * no accounts and no state beyond the current run, so anything more would be machinery
 * in search of a purpose.
 *
 * `localStorage` is used rather than IndexedDB or a server because the record is a few
 * hundred bytes and, crucially, because reading it is *synchronous*: the right room is
 * up before the first paint, with no flicker of level one on the way to wherever the
 * player actually left off. That single property is worth more here than durability.
 *
 * Nothing here throws. Losing your place is a disappointment; failing to reach the first
 * room because a value would not parse is considerably worse, so every failure — no
 * storage at all (private browsing, disabled cookies), bad JSON, a field of the wrong
 * type, a level id that no longer exists — degrades to a sane default rather than
 * propagating.
 */

const KEY = 'echo.progress.v1';

/** The best run on a level. Absent entirely until the level has been escaped once. */
export type LevelResult = { score: number; pings: number; moves: number };

export type Progress = {
  /** The level to resume on. */
  level: number;
  /** Show the floor plan before each room begins. */
  easy: boolean;
  /** Keyed by level id rather than index, so reordering the set never mixes results up. */
  results: Record<string, LevelResult>;
};

export function emptyProgress(): Progress {
  return { level: 0, easy: false, results: {} };
}

export function loadProgress(total: number): Progress {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return emptyProgress();

    const saved: unknown = JSON.parse(stored);
    if (!saved || typeof saved !== 'object') return emptyProgress();
    const raw = saved as Record<string, unknown>;

    return {
      level: readLevel(raw.level, total),
      easy: raw.easy === true,
      results: readResults(raw.results),
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Quota exceeded, or storage denied outright. Nothing to be done about it, and
    // nothing worth interrupting the game for.
  }
}

/** Clamped to a level that exists, so a shortened level list cannot strand the player. */
function readLevel(value: unknown, total: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), total - 1);
}

function readResults(value: unknown): Record<string, LevelResult> {
  if (!value || typeof value !== 'object') return {};
  const results: Record<string, LevelResult> = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const { score, pings, moves } = entry as Record<string, unknown>;
    if (!isCount(score) || !isCount(pings) || !isCount(moves)) continue;
    results[id] = { score, pings, moves };
  }
  return results;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
