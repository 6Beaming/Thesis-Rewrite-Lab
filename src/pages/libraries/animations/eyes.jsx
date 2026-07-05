export function createEyeController(ctx) {
  const { state, els, setTimeoutTracked } = ctx;

  function setEyeTransitions(value) {
    Object.values(els.eyes).forEach((side) => {
      if (side?.black) side.black.style.transition = value;
      if (side?.white) side.white.style.transition = value;
    });
  }

  function applyEyes() {
    const eye = state.eye;
    ['right', 'left'].forEach((name) => {
      const side = eye.sides[name];
      const eyeEls = els.eyes[name];
      if (!eyeEls?.black || !eyeEls?.white) {
        return;
      }
      const centerShift = eye.surprise ? (name === 'right' ? 4 : -4) : 0;
      const blackScaleY = eye.blackScaleY * eye.blinkScale;
      const whiteScaleY = eye.whiteScaleY * eye.blinkScale;
      eyeEls.black.style.transform = [
        `translate(${side.black.x + centerShift}px, ${side.black.y}px)`,
        `scale(${eye.blackScaleX}, ${blackScaleY})`,
      ].join(' ');
      eyeEls.white.style.transform = [
        `translate(${side.black.x + side.white.x + centerShift}px, ${side.black.y + side.white.y}px)`,
        `scale(${eye.whiteScaleX}, ${whiteScaleY})`,
      ].join(' ');
    });
  }

  function scheduleNextBlink() {
    if (!state.blinkEnabled) {
      return;
    }
    setTimeoutTracked(() => {
      blinkOnce();
      scheduleNextBlink();
    }, ctx.random(ctx.BLINK_MIN, ctx.BLINK_MAX));
  }

  function blinkOnce() {
    if (!state.blinkEnabled || state.eye.closed) {
      return;
    }
    state.eye.blinkScale = 0.04;
    applyEyes();
    setTimeoutTracked(() => {
      state.eye.blinkScale = 1;
      applyEyes();
    }, 50);
  }

  function randomPoint(radius) {
    const angle = ctx.random(0, Math.PI * 2);
    const distance = Math.sqrt(Math.random()) * radius;
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  }

  function nextWanderTarget(type, thinkingCase) {
    if (type === 'thinking') {
      const xSign = thinkingCase === 'left' ? -1 : 1;
      return {
        black: { x: ctx.random(1, 4) * xSign, y: ctx.random(-4, -1) },
        white: { x: ctx.random(2, 8) * xSign, y: ctx.random(-8, -2) },
      };
    }
    return {
      black: randomPoint(4),
      white: randomPoint(9),
    };
  }

  function clearEyeController() {
    state.eye.controller = 'neutral';
  }

  function resetEyes(instant = false) {
    clearEyeController();
    const eye = state.eye;
    eye.closed = false;
    eye.surprise = false;
    eye.blinkScale = 1;
    eye.blackScaleX = 1;
    eye.blackScaleY = 1;
    eye.whiteScaleX = 1;
    eye.whiteScaleY = 1;
    Object.values(eye.sides).forEach((side) => {
      side.black.x = 0;
      side.black.y = 0;
      side.white.x = 0;
      side.white.y = 0;
    });
    els.stage?.classList.remove('eye-closed', 'eye-surprise-active');
    setEyeTransitions(instant ? 'none' : 'transform 160ms ease');
    applyEyes();
    if (instant) {
      setTimeoutTracked(() => setEyeTransitions('transform 120ms ease'), 0);
    }
  }

  function eyeClose() {
    clearEyeController();
    state.eye.closed = true;
    state.eye.blinkScale = 0.05;
    els.stage?.classList.add('eye-closed');
    setEyeTransitions('none');
    applyEyes();
  }

  function startEyeWander(type, thinkingCase) {
    clearEyeController();
    resetEyes(false);
    state.eye.controller = type;

    let target = nextWanderTarget(type, thinkingCase);
    let lastTargetTime = performance.now();

    function tick(time) {
      if (state.eye.controller !== type) {
        return;
      }
      if (time - lastTargetTime > ctx.random(450, 1500)) {
        target = nextWanderTarget(type, thinkingCase);
        lastTargetTime = time;
      }
      ['right', 'left'].forEach((sideName) => {
        const side = state.eye.sides[sideName];
        side.black.x += (target.black.x - side.black.x) * 0.065;
        side.black.y += (target.black.y - side.black.y) * 0.065;
        side.white.x += (target.white.x - side.white.x) * 0.09;
        side.white.y += (target.white.y - side.white.y) * 0.09;
      });
      applyEyes();
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  return {
    applyEyes,
    startBlink() {
      state.blinkEnabled = true;
      scheduleNextBlink();
    },
    stopBlink() {
      state.blinkEnabled = false;
      state.eye.blinkScale = 1;
      applyEyes();
    },
    clearEyeController,
    resetEyes,
    eyeClose,
    startEyeObserve() {
      startEyeWander('observe');
    },
  };
}
