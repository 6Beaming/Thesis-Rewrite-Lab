export function createHeadController(ctx) {
  const { state, els, setVariantTimeout } = ctx;

  function startHeadRotatingLoop() {
    if (state.headLocked) {
      return;
    }
    const started = performance.now();

    function step() {
      if (state.mode !== 'standby' || state.activeVariant !== 'head-rotate' || state.headLocked) {
        return;
      }
      const elapsed = performance.now() - started;
      if (elapsed >= 5000) {
        els.headGroup.style.transition = 'transform 250ms ease';
        els.headGroup.style.transform = 'rotate(0deg) translate(0, 0)';
        if (state.standbyChoice === 'head-rotate') {
          setVariantTimeout(startHeadRotatingLoop, 1200);
        }
        return;
      }
      const direction = Math.random() > 0.5 ? 1 : -1;
      const angle = direction * ctx.random(4, 10);
      const y = ctx.random(-4, 4);
      els.headGroup.style.transition = 'transform 250ms ease';
      els.headGroup.style.transform = `rotate(${angle}deg) translate(${direction * 6}px, ${y}px)`;
      setVariantTimeout(step, 1250);
    }

    step();
  }

  function startMarkingTime() {
    state.headLocked = true;
    els.stage.classList.remove('mode-head-shake-left', 'mode-head-shake-right', 'mode-stabilized');
    els.headGroup.style.transform = '';
    els.stage.classList.add('marking-time');
    setVariantTimeout(() => {
      els.stage.classList.remove('marking-time');
      state.headLocked = false;
    }, 6000);
  }

  function enableHeadShake() {
    if (state.headLocked) {
      return;
    }
    els.stage.classList.remove('mode-head-shake-left', 'mode-head-shake-right');
    const direction = Math.random() > 0.5 ? 'left' : 'right';
    els.stage.classList.add(`mode-head-shake-${direction}`);
  }

  function enableHeadStabilized() {
    if (!state.headLocked) {
      els.stage.classList.add('mode-stabilized');
    }
  }

  function headThinkRotation(direction) {
    if (state.headLocked) {
      return;
    }
    const angle = direction === 'left' ? -10 : 10;
    els.headGroup.style.transition = 'transform 600ms cubic-bezier(0.4, 0, 0.2, 1)';
    els.headGroup.style.transform = `rotate(${angle}deg)`;
  }

  function resetHeadThinkRotation() {
    if (state.headLocked) {
      return;
    }
    els.headGroup.style.transition = 'transform 600ms cubic-bezier(0.4, 0, 0.2, 1)';
    els.headGroup.style.transform = 'rotate(0deg)';
  }

  return {
    startHeadRotatingLoop,
    startMarkingTime,
    enableHeadShake,
    enableHeadStabilized,
    headThinkRotation,
    resetHeadThinkRotation,
  };
}
