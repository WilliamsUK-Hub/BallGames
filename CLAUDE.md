# BallGames — project context for assistants

This file gives enough context to work on the codebase without rediscovering architecture from scratch.

## What this project is

A **browser-only**, **mobile-friendly** physics game (Suika-style): players **tap** to drop animal-themed balls into a fixed playfield. **Matching tiers merge** into the next tier. A **danger line** near the top ends the run if the stack crosses it.

- **Entry point:** single `index.html` (markup, styles, and game logic in one bundled `<script>`).
- **Physics:** [Matter.js](https://brm.io/matter-js/) v0.19.
- **Concave colliders:** [poly-decomp](https://github.com/schteppe/poly-decomp.js) v0.3, registered with `Matter.Common.setDecomp` so `Bodies.fromVertices` can decompose outlines.
- **Silhouette → vertices:** local `js/image-trace.js` (`ImageTrace.traceImageToVertices`).

Project rules for AI tooling also live in **`.cursorrules`** (stack, physics style, pointer events, modular-ish functions).

---

## Repository layout

| Path | Role |
|------|------|
| `index.html` | Full game: CDN scripts, UI, canvas, physics, merge logic, rendering, game-over. |
| `js/image-trace.js` | Alpha mask → boundary trace → simplify → scale to target radius; used when building colliders. |
| `assets/animal1.png` … `animal8.png` | One sprite per tier (level `k` uses `animal(k+1).png`). |
| `.cursorrules` | Conventions (Matter, canvas, mobile, physics tuning). |
| `.gitignore` / `LICENSE` | Standard project files. |

There is **no** bundler or `package.json` unless you add one.

---

## How to run locally

Serve the repo root over **HTTP** (not `file://`), e.g.:

```bash
# Python 3
python -m http.server 8080

# or Node
npx --yes serve .
```

Open the printed `localhost` URL and load `index.html` (default index).

---

## Script load order (critical)

1. `poly-decomp` — must expose `window.decomp` with `quickDecomp` (etc.).
2. `matter-js`
3. `js/image-trace.js`
4. Inline game code — calls `Matter.Common.setDecomp(window.decomp)` before using `fromVertices` with concave traces.

---

## Core game constants (in `index.html`)

- **`PLAY_WIDTH` / `PLAY_HEIGHT`** — fixed logical canvas size (e.g. 400×720); walls match this.
- **`NUM_ANIMALS` / `ANIMAL_URLS`** — `assets/animal1.png` … `animal8.png`; **`MAX_LEVEL = NUM_ANIMALS - 1`**.
- **`ballRadius(level)`** — `18 + level * 7`; used as **target size** for traced shapes, spawn margins, and approximate merge overlap (not always exact for irregular bodies).
- **`DANGER_LINE_Y`**, **`IN_PLAY_CLEAR_BELOW`** — game-over line and “in play” gating so spawns don’t instantly lose.
- Physics tunables: `REST_BALL`, `REST_WALL`, friction, `AIR_DRAG`, `MERGE_OVERLAP`, engine iteration counts.

---

## Ball creation pipeline

1. Images load → **`buildShapeCache()`** runs **`ImageTrace.traceImageToVertices(img, ballRadius(level), …)`** per tier.
2. **`cachedShapeData[level]`** holds `{ vertices, spriteDrawW, spriteDrawH }` or `null` (fallback).
3. **`createBall(x, y, level)`**:
   - If cached vertices exist: **`Bodies.fromVertices(x, y, [vertices], options, …)`** with poly-decomp.
   - Else: **`Bodies.circle`**.
4. Each ball stores **`shapeClipVertices`** (for canvas clip), **`spriteDrawW/H`**, **`ballLevel`**, **`inPlay`**, **`render.sprite`** (squish), etc.

---

## Merge detection

- **`collisionStart`** / **`collisionActive`**: `mergePair` when same `ballType`.
- **`afterUpdate`**: **`mergeOverlappingBalls()`** — distance check using **`ballRadius`** / overlap fudge; catches cases events miss.
- **`sameBallType`** uses **`ballType`** (tier index).

---

## Rendering

- **`requestAnimationFrame`** loop: clear → background → danger line → iterate **`Composite.allBodies`**, skip walls, **`drawAnimalBall`**.
- Draw order: translate to **`body.position`**, rotate **`body.angle`**, apply squish **`scale`**, clip (polygon or circle), **`drawImage`** centered with **`spriteDrawW/H`**.

---

## UI / layout

- Top HUD: next preview image, score.
- Playfield: **`#scaleWrap`** applies CSS **`transform: scale(...)`** so the fixed logical size fits the screen; wrapper size uses **`Math.ceil`** to avoid clipping borders.
- Game over: overlay, final score, **Play again** → full reload.

---

## Conventions worth preserving

- **Pointer events** (`pointerdown`) for input, not mouse-only APIs.
- **Modular-ish helpers** in the same file: `createBall`, `mergePair`, `checkDangerLine`, `buildShapeCache`, etc.
- **`.cursorrules`**: high restitution band, low friction preference, merge-on-same-tier, pointer events, viewport meta.

---

## Known limitations / gotchas

- **Merge overlap** uses **spherical approximation** (`ballRadius`); irregular bodies may behave slightly differently than perfect circles.
- **Traced clip path** uses the **input** polygon; Matter may adjust internal geometry after decomposition — rare visual vs physics mismatch at sharp corners.
- **Convex hull fallback** in `image-trace.js` (when Moore trace is too short) is **not** concave-accurate.
- **CDN availability** — if jsDelivr/cdnjs fail, physics or decomp may break; for production, consider vendoring scripts.

---

## Suggested edits by task type

| Task | Where to look |
|------|----------------|
| New tier / asset | `NUM_ANIMALS`, `ANIMAL_URLS`, add `assets/animalN.png`, `buildShapeCache`. |
| Physics feel | Constants at top of `index.html`, wall creation in `resize()`. |
| Danger / difficulty | `DANGER_LINE_Y`, `IN_PLAY_CLEAR_BELOW`, `checkDangerLine` / `markBallsInPlay`. |
| Collider quality | `js/image-trace.js` (`maxTraceDim`, `rdpEpsilon`), `Bodies.fromVertices` extra args in `createBall`. |
| Visual-only | `drawAnimalBall`, HUD CSS, `#playShell` / `#scaleWrap`. |

---

*Last aligned with the codebase as a single-page Matter + traced-sprite merge game. Update this file when architecture changes (e.g. split modules, bundler, tests).*
