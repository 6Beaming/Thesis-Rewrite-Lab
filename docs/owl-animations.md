# Owl Animation System

Last updated: 2026-07-06

This document describes the current reusable owl animation system after moving the sandbox behavior into React components and page libraries.

## Current Decision

The app uses one fixed `512x512` owl SVG coordinate system for desktop and mobile. Layout scaling is handled by containers and CSS variables. Most motion is CSS/DOM-transform based, while wing/wand poses use a small generated SVG path catalog because those shapes need accurate path morphs.

Current frontend flow:

```text
owl-container-layout.json -> CSS vars -> layered boxes scale
src/assets/owl.svg fixed 512x512 viewBox -> inline SVG -> uniform scale
scripts/build-owl-path-catalog.cjs -> scripts/generated/owl-path-catalog.json
animation libraries -> CSS/DOM transforms plus path morphs for wings/wand
```

Why this remains the fastest development path:

- Standby, head, eyes, feet, notes, indicators, and most particles stay transform/CSS driven.
- Wing lift and wand show are visually sensitive and still benefit from real SVG path morphing.
- The app keeps one art coordinate system, so desktop/mobile layout changes do not require separate SVGs.
- The path catalog keeps the proven `local/animations/` wing/wand behavior without reintroducing large runtime SVG rewriting scripts.

## Key Files

| File | Responsibility |
| :--- | :--- |
| `src/components/OwlContainer.jsx` | Reusable owl component: indicators, inline owl SVG, generated inline wand group, particle layer, bottom asset |
| `src/pages/libraries/animations/createOwlAnimator.jsx` | Main animator facade: standby, thinking, error, wand, magic, pointer chase |
| `src/pages/libraries/animations/useOwlAnimator.jsx` | React hook for mounting animator and binding props/events |
| `src/pages/libraries/animations/animationState.jsx` | Animation state, timers, DOM getters, cleanup helpers |
| `src/pages/libraries/animations/eyes.jsx` | Blink, observe, thinking gaze, eye chase, surprise |
| `src/pages/libraries/animations/head.jsx` | Head shake, rotate, stabilized, marking time, thinking tilt |
| `src/pages/libraries/animations/particles.jsx` | Sleep notes, magic particles, button-local bursts |
| `src/pages/libraries/animations/standby.jsx` | Standby variant orchestration |
| `src/styles/animations/*.css` | Base SVG, eye, head, feet, and particle animation styles |
| `scripts/generated/owl-path-catalog.json` | Generated path catalog consumed by the React app |

## Sandbox Reference

`local/animations/test.html` remains the historical reference for correct motion timing and path poses.

Important sandbox modules:

| File | Role |
| :--- | :--- |
| `local/animations/js/right-wing.js` | Right wing path morph, lift/back timing, tremor |
| `local/animations/js/left-wing.js` | Left wing and wand path maps |
| `local/animations/js/wand.js` | Wand show, tremor, magic use, retract |
| `local/animations/js/eyes.js` | Blink, observe, think, surprise, chase |
| `local/animations/js/head.js` | Head standby, thinking, and error motion |

The React implementation is not expected to import from `local/`; local files are private reference material only.

## Path Catalog

The React app imports:

```js
scripts/generated/owl-path-catalog.json
```

Regenerate after changing `src/assets/owl.svg`, reference wing/wand pose SVGs, or `scripts/owl-path-config.json`:

```bash
node scripts/build-owl-path-catalog.cjs
```

Catalog sections:

| Section | Used by |
| :--- | :--- |
| `rightWing.before/after` | Thinking wing lift, tremor hold, wing back |
| `leftWing.before/intermediate/after` | Wand clench/show/ready pose |
| `wand.intermediate/after` | Inline wand materialization and ready pose |

## Reusable Component Contract

```jsx
<OwlContainer
  variant="desktop"
  standby="random"
  animation={{
    loading,
    error,
    errorKey,
    trackPointer: true,
    magicClick: false,
  }}
  onAnimatorReady={(animator) => {
    owlAnimatorRef.current = animator;
  }}
/>
```

The animator facade exposes:

| Method | Behavior |
| :--- | :--- |
| `enterStandby(choice)` | Starts one standby variant or random standby loop |
| `startThinking()` | Thinking indicator, thinking eyes/head, right wing lift/tremor |
| `endThinking()` | End thinking, flash answer, return to standby |
| `triggerError()` | Error indicator, surprise eyes, head shake, timed recovery |
| `showWand()` | Left wing/wand show, ready pose, tremor, 30s idle timer |
| `useMagic(target, options)` | Fire magic particles at/around a target while keeping wand visible |
| `handlePointerMove(event)` | Eye chase pointer tracking |
| `stopEyeChase()` | Clears eye chase mode |

## Composite Animations

### Standby

API:

```js
animator.enterStandby('random' | 'head-shake' | 'observe-mark' | 'sleep-notes' | 'head-rotate')
```

Current variants:

| Variant | Behavior |
| :--- | :--- |
| `head-shake` | Head/wing tilt with observe eyes |
| `observe-mark` | Eye observe + marking-time foot/body motion |
| `sleep-notes` | Closed eyes with floating music-note smoke |
| `head-rotate` | Eye observe + head rotation loop |
| `random` | Rotates through variants |

Pointer eye chase is intentionally not used when eyes are closed during `sleep-notes`.

### Thinking / Loading

Triggered by `animation.loading = true` or `animator.startThinking()`.

Sequence:

1. Clear passive state.
2. Show `thinking.svg`.
3. Start thinking eye movement and head tilt.
4. Morph right wing to lifted pose.
5. Run right-wing tremor.
6. On end, hide thinking, flash answer, return right wing, and return to standby.

Magic has priority over thinking. If a click starts magic and loading at nearly the same time, thinking waits for the magic priority promise so the particle effect is visible first.

### Error

Triggered by `animation.error = true` and `animation.errorKey`.

Sequence:

1. Stop passive motion.
2. Show `error.svg`.
3. Run surprise eyes.
4. Run head shake.
5. Return right wing if interrupted from thinking.
6. Recover after about 5.6s.

### Interaction / Success / Magic

Hover targets call `animator.showWand()`. Click targets call `animator.useMagic(target, options)`.

Current behavior:

1. `showWand()` morphs left wing to intermediate and then ready pose.
2. The inline `#magic_wand` morphs to ready pose and becomes visible.
3. Wand/left-wing tremor can continue while idle.
4. `useMagic()` fires particles without retracting or disabling the wand.
5. Hover after magic can immediately refresh/resync the wand pose.
6. Wand retracts only after the 30s idle timer, not immediately after magic use.

Important implementation detail:

`showWand()` now repairs the DOM pose even when internal state already says `ready` or `tremor`. This is needed because standby and page transitions can clear stage classes. A hover request must always be able to restore `left-wing-wand-ready`, `is-visible`, and `is-ready`.

## Particle Modes

| Mode | Use case |
| :--- | :--- |
| Default curved trail | Short/nearby target paths where wand-to-target motion is visually useful |
| `{ effect: 'button-burst' }` | Distant buttons/cards, auth login, workspace cards; more stable across desktop/mobile |

The auth and workspace pages currently prefer button-local burst behavior because layout-relative curved paths are expensive to tune across responsive containers.

## Current Page Bindings

### Auth

| Event | Owl behavior |
| :--- | :--- |
| Page idle | Standby |
| Pointer move | Eye chase unless eyes are closed |
| Button hover | Show wand and hold/rearm idle timer |
| Button click | Button-local magic burst, then fake request/loading |
| Loading | Thinking animation |
| Incorrect login | Error animation |
| Successful login | Success message, then navigate to homepage |

Auth is frontend-only:

- Email: `test@example.com`
- Password: `123456`
- Delay: 5s fake request

### Workspace Desktop

| Event | Owl behavior |
| :--- | :--- |
| Idle | Random standby |
| Rewriting/practicing card hover | Show wand and keep it available |
| Rewriting card click | Use magic with button-local/card-local burst, then apply placeholder text |
| Regenerate click | Thinking while placeholder response is generated |
| Regenerate card 2 | Simulated error after delay |
| Practicing try response | Magic + thinking while placeholder response is generated |

### Workspace Mobile

The floating owl uses the same `OwlContainer` and animator facade. The mobile assistant panel exposes rewriting/practicing cards, while the owl acts as the floating entry point.

## Current Frontend Status

Working:

- Reusable owl component for auth, desktop workspace, and mobile/floating workspace.
- Standby, thinking, error, eye chase, wand show, magic burst, and indicators.
- Wand hover survives magic use and can be retriggered.
- Thinking waits for magic priority.
- Error animation can recover back to standby.

Known constraints:

- The default curved particle trail is available but not preferred for distant page controls.
- Button/card-local burst is the stable default for auth/workspace interactions.
- Animation logic is frontend-only. Backend request success/failure is currently simulated in many flows.

## Backend And Content Dependencies

Animations are frontend-ready, but several page flows that trigger them are still placeholder-driven:

| Flow | Current data source | Backend dependency |
| :--- | :--- | :--- |
| Auth loading/error/success | Frontend test account | Real auth/session/password-reset backend not started |
| Rewriting cards | Placeholder local generator | AI/service backend not started |
| Practicing response | Placeholder local generator | AI/service backend not started |
| Upload-triggered workspace docs | UI/scaffold exists, not reliable | Upload parser + PostgreSQL persistence incomplete |
| Version history animations/interactions | Dummy/demo data | Version API/model/database incomplete |

## Maintenance Notes

- Keep animation JS in `src/pages/libraries/animations/`.
- Keep animation CSS in `src/styles/animations/`.
- Keep `OwlContainer.jsx` reusable; page-specific behavior should call the animator facade, not duplicate SVG logic.
- Regenerate the path catalog after changing owl art or reference pose assets.
- Do not import runtime behavior from `local/animations/`; use it only as a reference.
