# Owl Animation System

Last updated: 2026-07-06

This is the current alpha report for the reusable owl animation system after the migration from local sandbox scripts into React components, shared animation libraries, and page bindings.

## Current Design Decision

The project uses one fixed `512x512` owl SVG coordinate space for both desktop and mobile. Container scaling is handled by CSS variables and layout helpers. Most motion is transform-driven, but the wing and wand still use a generated path catalog because those shapes are visually sensitive and the old sandbox proved that path morphing is more reliable there than pure transforms.

Current runtime path:

```text
src/assets/owl.svg (fixed 512x512 viewBox)
-> OwlContainer inline SVG render
-> container layout CSS vars
-> JS animator facade
-> CSS transforms, class toggles, and path morphs
```

Build-time support path:

```text
scripts/build-owl-path-catalog.cjs
-> scripts/generated/owl-path-catalog.json
-> src/components/OwlContainer.jsx + animation libraries
```

## Why This Path Was Kept

- It matches the current standby architecture already used in React.
- It avoids reintroducing broad runtime SVG rewriting across multiple responsive layouts.
- It preserves accurate left-wing and wand poses from the old local animation reference.
- It keeps desktop and mobile on the same art system, which simplifies reuse.

## Main Runtime Files

| File | Responsibility |
| --- | --- |
| `src/components/OwlContainer.jsx` | Shared owl stage, indicators, particle layer, bottom asset, inline wand injection |
| `src/pages/libraries/animations/useOwlAnimator.jsx` | React hook that mounts the animator to a stage ref |
| `src/pages/libraries/animations/createOwlAnimator.jsx` | Public animator facade used by pages/components |
| `src/pages/libraries/animations/animationState.jsx` | Timer/state registry and DOM access helpers |
| `src/pages/libraries/animations/standby.jsx` | Standby mode orchestration |
| `src/pages/libraries/animations/eyes.jsx` | Blink, observe, think, surprise, pointer-chase |
| `src/pages/libraries/animations/head.jsx` | Head tilt/rotate/shake helpers |
| `src/pages/libraries/animations/particles.jsx` | Notes, magic particles, local burst effects |
| `src/styles/animations/*.css` | Shared animation styling |
| `scripts/generated/owl-path-catalog.json` | Generated source for wing and wand morph poses |

## Local Sandbox Reference

The historical animation truth source is still:

- `local/animations/test.html`
- `local/animations/js/left-wing.js`
- `local/animations/js/right-wing.js`
- `local/animations/js/wand.js`
- `local/animations/js/eyes.js`
- `local/animations/js/head.js`

These files are reference material only. Runtime product code does not import from `local/`.

## Path Catalog

The app consumes `scripts/generated/owl-path-catalog.json`.

Regenerate it after changing owl art or morph references:

```bash
node scripts/build-owl-path-catalog.cjs
```

Current catalog usage:

| Catalog section | Used by |
| --- | --- |
| `rightWing.before/after` | Thinking lift and recovery |
| `leftWing.before/intermediate/after` | Show-wand and ready/tremor poses |
| `wand.intermediate/after` | Wand materialization and ready state |

## Reusable Component Contract

```jsx
<OwlContainer
  variant="desktop"
  standby="random"
  onAnimatorReady={(animator) => {
    owlAnimatorRef.current = animator;
  }}
  animation={{
    loading,
    error,
    errorKey,
    trackPointer: true,
    magicClick: false,
  }}
/>
```

Animator methods used across the app:

| Method | Role |
| --- | --- |
| `enterStandby(choice)` | Starts one standby loop or the random standby cycle |
| `startThinking()` | Shows thinking indicator, thinking eyes/head, right-wing lift/tremor |
| `endThinking()` | Hides thinking, flashes answer, and returns to standby |
| `triggerError()` | Shows error indicator with surprise eyes and head shake |
| `showWand()` | Materializes the left-wing wand and keeps it visible with an idle timer |
| `useMagic(target, options)` | Fires particle effects at or around a target |
| `handlePointerMove(event)` | Drives eye tracking |
| `stopEyeChase()` | Clears eye chase mode |

## Active Animation Families

### Standby

Current standby variants:

- `head-shake`
- `observe-mark`
- `sleep-notes`
- `head-rotate`
- `random`

Notes:

- `random` rotates through the available standby modes.
- Pointer eye-chase is intentionally suppressed while eyes are closed in `sleep-notes`.

### Thinking

Triggered by `animation.loading` or `animator.startThinking()`.

Sequence:

1. Clear passive state.
2. Show the thinking indicator.
3. Start thinking eyes and head tilt.
4. Morph the right wing upward.
5. Hold the right-wing tremor state.
6. On completion, flash the answer indicator, return the right wing, and resume standby.

### Error

Triggered by `animation.error` plus a changing `errorKey`.

Sequence:

1. Show the error indicator.
2. Run surprise eyes.
3. Run head shake.
4. Recover to standby after the error window ends.

### Show Wand / Interaction

Triggered by `animator.showWand()` on hover/focus targets.

Sequence:

1. Morph the left wing into the reveal/ready pose.
2. Materialize the inline wand markup.
3. Enter the visible ready or tremor hold state.
4. Refresh the idle timer whenever hover/focus triggers again.

The current intent is for the wand to remain pinned in the ready/tremor state for the idle window instead of retracting immediately after a click effect.

### Magic

Triggered by `animator.useMagic(target, options)`.

Current preferred mode for the auth page and workspace cards/buttons:

- `{ effect: 'button-burst' }`

The previous traveling curved particle path is no longer preferred in these layouts because responsive geometry made the start/end alignment unstable. A small burst local to the button/card is much more reliable.

## Current Page Bindings

### Auth (`src/components/RequireSignIn.jsx`)

| Event | Owl behavior |
| --- | --- |
| Idle | `head-rotate` standby |
| Pointer move | Eye chase |
| Button hover/focus | `showWand()` |
| Button click | `useMagic(..., { effect: 'button-burst' })` |
| OAuth launch wait | Thinking/loading state |
| Auth error | Error indicator + error animation |

Notes:

- The auth page is now Google OAuth only.
- The old `test@example.com` / `123456` fake auth flow has been removed from the live route path.

### Workspace desktop (`src/pages/WorkspacePage.jsx`)

| Event | Owl behavior |
| --- | --- |
| Idle | Random standby |
| Rewriting/practicing card hover | `showWand()` |
| Rewriting card click | Local magic burst + placeholder apply |
| Regenerate click | Thinking animation during placeholder delay |
| Simulated rewrite error | Error animation |
| Practicing try response | Magic + thinking during placeholder delay |

### Workspace mobile

The floating owl uses the same component and animator API. The mobile assistant panel reuses the same rewrite/practice logic while changing only layout and interaction framing.

## Known Constraints

| Constraint | Impact |
| --- | --- |
| Wand/show-wand, magic, and editor refreshes still depend on DOM class/state coordination | Some interaction bugs are still easier to trigger during rapid workspace changes than in the isolated local sandbox. |
| Animation triggers are frontend-only | Backend success/failure does not yet drive all animation outcomes with real persistence timing. |
| Curved travel particles are not the default anymore | The current product favors stable local bursts over precise wand-to-target curves in responsive layouts. |

## Backend Dependencies

The owl system itself is frontend-ready, but several flows that trigger it are still placeholder-driven:

| Flow | Current source | Missing backend work |
| --- | --- | --- |
| Auth success/failure timing | Real Auth.js for sign-in, frontend fallback for some local messaging | Full DB/OAuth configuration |
| Rewrite regeneration | Local placeholder delay | Real rewriting service |
| Practice response | Local placeholder delay | Real practice service |
| Upload-triggered workspace state | Mixed scaffold and local fallbacks | Reliable upload + persistence pipeline |
| Version history interactions | Demo or partial API data | Fully verified versions backend |

## Maintenance Notes

- Keep runtime animation logic under `src/pages/libraries/animations/`.
- Keep runtime animation CSS under `src/styles/animations/`.
- Keep `OwlContainer.jsx` reusable and page-agnostic.
- Regenerate the path catalog after changing owl SVG geometry or wing/wand reference poses.
- Use `local/animations/` only as reference material, not as product runtime code.

