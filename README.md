# Echo

A blind escape game for the browser. You never see the room — only what comes back.

Each call sends a narrow, bat-like beam into the dark and draws nothing but the returning
echoes: a bearing, a delay, a loudness, a colour for what the sound hit. A wall square-on
answers loudly; the same wall at a glancing angle throws its energy away and answers with
almost nothing; **an opening is a direction that does not answer at all.** Stepping is
free of sound but blind, so the cheapest escape is the one where you trust a single call
for several moves.

Twenty-five rooms, from a single doorway to mazes with soft panels that swallow a call
and make a dead end sound exactly like a way out.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/, deployable anywhere
```

The build has no server component and no external requests — `dist/` can be dropped onto
any static host, in any subdirectory.

## Hosting

Pushing to `main` builds and publishes to GitHub Pages via `.github/workflows/deploy.yml`.

This needs enabling once, by hand: **Settings → Pages → Build and deployment → Source →
GitHub Actions**. The workflow cannot do it for itself — `configure-pages` accepts
`enablement: true`, but `GITHUB_TOKEN` is not permitted to create a Pages site and the run
fails with *Resource not accessible by integration*.

It has to be **GitHub Actions**, not "Deploy from a branch". Choosing the branch option
fails in the worst possible way: GitHub serves the repository verbatim, so the root
`index.html` — the Vite dev entry, which points at `/src/main.tsx` — is what reaches the
browser. A browser cannot execute TypeScript, so nothing mounts and the site is a blank
page that returns 200. The tell is that `/README.md` and `/src/main.tsx` are also fetchable,
and that the run which succeeded is called "pages build and deployment" (GitHub's built-in
branch workflow) rather than "Deploy".

The site is then served from a subdirectory, which is why `vite.config.ts` sets
`base: './'` — every asset path in the build is relative, so the same `dist/` works at a
domain root or under any path.

## Playing

| | |
|---|---|
| click / tap | call in that direction |
| `space` | step |
| `R` | restart the room |
| `esc` | the record |

On a mouse, a faint dashed line follows the cursor to show where a call would go. A call
is the expensive move; walking blind is meant to be the cheap, frightening option.

Scoring starts at 1000 and pays for every call and step beyond the room's optimum, so
using the sense less always scores better. Those optima are not estimates — see below.
The first five rooms allow giving up, because being shown the room you failed to read is
the lesson; after that the floor plan is what you get for finding the way out.

Progress lives in `localStorage` under `echo.progress.v1`. Easy mode, on the record
screen, shows each room's plan before you go in — the shape and the doorway, but never
where *you* are, which is the question the sense actually answers.

## Layout

```
src/game/      the game, with no idea it is on a web page
  world.ts       ground truth: walls, materials, reflectivity
  geometry.ts    ray casting, shared by sound and by bodies
  echo.ts        echolocation as a pure projection of the world
  levels.ts      25 rooms, and the verified cost of escaping each
  run.ts         one escape attempt, as pure state transitions
  render/        how an echo becomes something you can see
  progress.ts    what survives between visits
src/ui/        React components, canvas, and CSS
scripts/       the solver and a headless smoke test
```

`src/game/` is dependency-free TypeScript, carried over unchanged from the native build.
It knows nothing about React, the DOM, or the canvas — `emit()` returns physical facts
about returning sound, and a renderer decides whether those become marks on a screen or
delayed taps in a pair of headphones.

## Verifying it

```bash
npm run solve    # exhaustive search for every room's optimum
npm run smoke    # every screen renders; a call still returns sound
npm run build    # typecheck and bundle
```

`npm run solve` is the real acceptance test. It searches headings and step counts for the
cheapest escape from each of the 25 rooms, then replays the route it finds through the
actual game reducer and checks the result scores exactly 1000. A clean run proves the
raycasting, the movement model, the level geometry and the scoring all agree with the
numbers written in `levels.ts`. Re-run it after touching any geometry.

## Notes on the port

This began as an Expo / React Native app. Three things changed:

- **The field is a canvas.** Natively each echo was its own animated node. A single call
  returns up to 300 echoes and two calls can be in flight at once, so that approach would
  put ~600 independently animating elements on the page. It is now one canvas driven by
  one `requestAnimationFrame` loop, evaluating the same timing constants by hand.
- **Floor plans are SVG.** The native build positioned and rotated a `View` per wall
  because it had no other primitive. A `viewBox` matching the world does that job.
- **Progress is `localStorage`,** read synchronously on the first render so the right room
  is up before the first paint, with no flicker of level one on the way to wherever you
  left off.

Everything else — the physics, the rooms, the rules, the palette — is unchanged.
