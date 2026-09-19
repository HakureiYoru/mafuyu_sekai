# First-batch optimization and rendering clarity

Based on master `65cea13a033be92b6e5fa232300ab15fbb339613` (v6.1.2).

## Runtime

HUD publications use cached score/history summaries. The cache is refreshed after initialization, opening a new run, external storage merges, score recording, and completion recording. SaveRepository still owns mutable data and returns defensive copies; gameplay updates do not obtain full profile/history copies.

Ordinary start/restart requests a new nonzero uint32 seed. Explicit `start({seed})` still forwards the seed unchanged, including zero. Debug practice remains fixed-seed. The active seed is available through `window.__MAFUYU_DEBUG__.seed()` in debug mode for reproduction. No combat/balance parameters changed.

Fullscreen unavailable/rejected errors now reach the UI. Optional orientation-lock rejection does not turn a successful fullscreen request into an error.

## Rendering

The old renderer already handled DPR in resize(); initialization at resolution 1 was not itself the root cause. Its 540p mobile-low pixel ceiling and DPR 1.5 ceiling limited clarity. New budgets are independent of the particle/star scale and bounded by the displayed physical size:

| Quality | Touch maximum buffer | Desktop maximum buffer |
| --- | --- | --- |
| Low | 1280 x 720 | 1920 x 1080 |
| Medium | 1600 x 900 | 2560 x 1440 |
| High | 1920 x 1080 | 2880 x 1620 |

DPR is capped at 2 on touch and 2.5 on desktop. Smaller displays do not allocate the full budget. The 1600 x 900 logical coordinate system, field of view, collision geometry, CSS layout, and pointer mapping are unchanged. No whole-canvas pixelated sampling or sharpening filter is applied. Text/bitmap fonts use resolution 2 instead of 1.5. Particle counts are unchanged. DPR changes re-arm a media query, resize and redraw paused screens; redundant buffer resizes are avoided and listeners are released on destroy.

Higher pixel budgets increase fill-rate and framebuffer cost. Real phone temperature, battery use and sustained FPS still require physical-device checks; desktop Chromium/WebKit emulation is not a real iPhone/Android performance measurement. Low-resolution source artwork cannot regain missing detail through a larger framebuffer.

## Validation and release gates

`npm run check` runs typecheck, lint, unit tests, asset validation and production build. Vercel now uses this command, so those failures block its build. PRs and master pushes run the same check plus a focused Playwright matrix: desktop DPR 2, touch Chromium DPR 3 and touch WebKit DPR 3. The matrix covers lifecycle/upgrade, seed behavior, saved-score reload, fullscreen fallback, buffer sizing and rotation; its screenshots and failure traces are uploaded.

Run browser smoke locally after building:

```sh
npm ci --include=dev
npm run check
npx playwright install --with-deps chromium webkit
npx playwright test --config playwright.smoke.config.ts
```

Test definitions are not a claim of passing results; consult the actual CI run for this revision. Existing full desktop/mobile suites and long soaks remain available. GitHub branch-protection/ruleset settings are not changed by this patch; making the CI job a required merge check is a separate repository setting. The Vercel build gate does not include browser tests.
