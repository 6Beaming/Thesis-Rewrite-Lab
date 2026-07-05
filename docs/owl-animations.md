# Owl Animation System

Last updated: 2026-07-05

This document describes the current owl animation path after comparing the working sandbox in `local/animations/` with the React app.

## Current Decision

Use the fixed `512x512` owl SVG viewBox for both desktop and mobile layout scaling, but keep a small generated SVG path catalog for animations that genuinely need path morphing.

Current frontend flow:

```text
owl-container-layout.json -> CSS vars -> layered boxes scale
src/assets/owl.svg fixed 512x512 viewBox -> CSS 100% fill -> uniform scale
scripts/build-owl-path-catalog.cjs -> scripts/generated/owl-path-catalog.json
animation libraries -> CSS/DOM transforms plus path morphs for wings/wand
```

Why this is faster now:

- Standby, eyes, head, feet, indicators, and particles stay transform/CSS driven.
- The old local wing/wand animations were correct because they morphed real inline SVG paths.
- Reusing that catalog avoids visually re-tuning complex wing and wand poses as approximated transforms.
- The app still has one art coordinate system; the script converts reference SVG paths into the current `owl.svg` coordinate space.

## Sandbox Reference

`local/animations/test.html` remains the historical reference. It embeds the full owl SVG inline and includes `#magic_wand` inside `#left_wing_group`, which is why old wand path morphing worked.

Important local modules:

| File | Role |
| :--- | :--- |
| `local/animations/js/right-wing.js` | Right wing path morph, lift/back timing, tremor rotate |
| `local/animations/js/left-wing.js` | Left wing and wand path maps |
| `local/animations/js/wand.js` | Wand show, tremor, magic use, retract |
| `local/animations/js/eyes.js` | Blink, observe, think, surprise, chase |
| `local/animations/js/head.js` | Head standby, thinking, and error motion |

## Path Catalog

The React app imports `scripts/generated/owl-path-catalog.json`.

Regenerate it after changing `src/assets/owl.svg`, `src/assets/test_right_wing_anim.svg`, `src/assets/test_left_wing_anim.svg`, or `scripts/owl-path-config.json`:

```bash
node scripts/build-owl-path-catalog.cjs
```

The generator uses the current `owl.svg` before pose as the anchor. For each reference asset, it computes the translation from the reference before pose once, then applies that same translation to intermediate/after poses. This preserves the old lift/relocation instead of flattening every pose back to the same anchor.

Catalog sections:

| Section | Used by |
| :--- | :--- |
| `rightWing.before/after` | Thinking right-wing lift, tremor hold, back |
| `leftWing.before/intermediate/after` | Wand show/clench/ready |
| `wand.intermediate/after` | Inline wand materialization and ready pose |

## React Implementation

| File | Responsibility |
| :--- | :--- |
| `src/components/OwlContainer.jsx` | Mounts indicators, inline `owl.svg`, generated inline `#magic_wand`, particle layer, and bottom assets |
| `src/pages/libraries/animations/createOwlAnimator.jsx` | Facade for standby, thinking, error, wing path morphs, wand path morphs, and magic actions |
| `src/pages/libraries/animations/useOwlAnimator.jsx` | React hook for standby choice, loading/error/errorKey props, pointer chase, and magic target binding |
| `src/pages/libraries/animations/animationState.jsx` | Shared state, timers, live SVG element getters, stage cleanup |
| `src/pages/libraries/animations/eyes.jsx` | Blink, observe, pointer chase, thinking gaze, error surprise |
| `src/pages/libraries/animations/head.jsx` | Head shake, rotate, stabilized mode, thinking tilt |
| `src/pages/libraries/animations/particles.jsx` | Sleep notes, default magic trail, and button-local burst particles |
| `src/styles/animations/base.css` | Inline wand visibility, materialize/retract animation, star particles |

`animationState.jsx` exposes live getters for SVG elements. This matters because React page state can refresh inline SVG markup; animation controllers should always touch the current DOM nodes.

## Composite Animations

### Standby

API:

```js
animator.enterStandby('random' | 'head-shake' | 'observe-mark' | 'sleep-notes' | 'head-rotate')
```

`sleep-notes` closes the eyes, so pointer eye chase intentionally does not run during that standby variant.

### Thinking / Loading

Triggered by `animation.loading = true` or `animator.startThinking()`. If `useMagic(target)` is currently active, thinking waits for the magic priority promise before clearing the wand state.

Sequence:

1. Clear passive state and show `thinking.svg`.
2. Start thinking eye wander and head rotation.
3. Morph right-wing paths to the generated `after` pose.
4. Rotate/tremor `#right_wing_group` around the lifted pose.
5. On completion, hide thinking, flash answer, morph right wing back, then return to standby.

### Error

Triggered by `animation.error = true` plus `animation.errorKey` for repeated errors.

Sequence:

1. Stop passive motion.
2. Show `error.svg`.
3. Run `eyeSurprise()` on current eye nodes.
4. Run `mode-error-shake` head animation.
5. If interrupted from thinking, right wing returns in parallel.
6. Auto-recover after about 5.6s.

### Interaction / Success

Triggered by `animation.magicTargets`, `animator.showWand()`, or `animator.useMagic(target, options)`.

Sequence:

1. Hover target: morph left wing to intermediate, then after.
2. Injected inline wand morphs from intermediate to after and becomes visible.
3. Ready state starts wand/left-wing tremor.
4. Click/use: fire either the default curved star trail or a button-local burst.
5. Magic use owns animation priority for the particle effect; loading/thinking can be requested during this time but should enter after the effect.
6. Wand tremor is suppressed for 10s after use and auto-retracts after 30s idle.

The default curved trail derives its start point from SVG geometry, not the `<g>` bounding client rect: `#middle_filler` / `#wand_frame` coordinates are transformed through `getScreenCTM()` and then converted into the stage coordinate system. Particle size and path noise scale with the current owl stage width.

Use `{ effect: 'button-burst' }` for distant controls, such as the auth login button. This emits a local burst from the target center plus a small wand-tip sparkle, avoiding long curve/noise tuning across desktop and mobile layouts.

## React Usage

```jsx
<OwlContainer
  variant="desktop"
  standby="head-rotate"
  animation={{
    loading,
    error,
    errorKey,
    magicTargets: [buttonRef],
    magicClick: false,
    trackPointer: true,
  }}
  onAnimatorReady={(animator) => {
    owlAnimatorRef.current = animator;
  }}
/>
```

Use `magicClick: false` when a button also starts loading. Then call `animator.useMagic(buttonElement, { effect: 'button-burst' })` in the page handler before setting `loading = true`, so the local magic burst is visible before the thinking composite takes over. Omit the option when a page wants the default wand-to-target curved trail.

## Auth Test Page Binding

Current auth test flow:

| Event | Expected owl behavior |
| :--- | :--- |
| Page idle | Standby animation |
| Pointer move | Eye chase, unless eyes are closed |
| Button hover | Wand show + left-wing morph + wand tremor |
| Button click | Start fake request immediately; play button-local burst first |
| Fake login request | After magic priority releases: thinking indicator, head think rotation, eye thinking, right-wing morph/tremor |
| Incorrect login | Error message, error indicator, head shake, surprise eyes |
| Successful login | Success message, then navigate to dummy homepage |

The test account is implemented only in the frontend page:

- Email: `test@example.com`
- Password: `123456`
- Delay: 5s fake request, for testing thinking/loading animation
