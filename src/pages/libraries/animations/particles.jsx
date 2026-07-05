export function createParticleController(ctx) {
  const { state, els, pick, random, setVariantInterval, setVariantTimeout } = ctx;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function centerOf(el) {
    if (!el || !els.stage) {
      return { x: 0, y: 0 };
    }
    const rect = el.getBoundingClientRect();
    return viewportToStage(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function viewportToStage(x, y) {
    const stageRect = els.stage.getBoundingClientRect();
    return {
      x: x - stageRect.left,
      y: y - stageRect.top,
    };
  }

  function svgPointToStage(el, x, y) {
    const matrix = el?.getScreenCTM?.();
    if (!matrix) {
      return null;
    }

    if (typeof DOMPoint === 'function') {
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      return viewportToStage(point.x, point.y);
    }

    const svg = el.ownerSVGElement;
    const point = svg?.createSVGPoint?.();
    if (!point) {
      return null;
    }
    point.x = x;
    point.y = y;
    const transformed = point.matrixTransform(matrix);
    return viewportToStage(transformed.x, transformed.y);
  }

  function pointOnSvgElement(el, xRatio = 0.5, yRatio = 0.5) {
    try {
      const box = el?.getBBox?.();
      if (!box) {
        return null;
      }
      return svgPointToStage(el, box.x + box.width * xRatio, box.y + box.height * yRatio);
    } catch {
      return null;
    }
  }

  function magicStartPoint() {
    const starCore = els.stage?.querySelector('#middle_filler');
    const wandFrame = els.stage?.querySelector('#wand_frame');
    const wandGroup = els.stage?.querySelector('#magic_wand') ?? els.magicWand;

    return (
      pointOnSvgElement(starCore, 0.5, 0.45)
      ?? pointOnSvgElement(wandFrame, 0.55, 0.18)
      ?? centerOf(wandGroup)
    );
  }

  function particleMetrics() {
    const stageWidth = els.stage?.getBoundingClientRect().width || 512;
    const stageScale = clamp(stageWidth / 512, 0.38, 1);
    return {
      stageScale,
      starSize: clamp(7, 18 * stageScale, 18),
      controlDriftX: 180 * stageScale,
      controlDriftYMin: 100 * stageScale,
      controlDriftYMax: 250 * stageScale,
      noiseMin: 20 * stageScale,
      noiseMax: 45 * stageScale,
      offsetMax: 24 * stageScale,
    };
  }

  function cubicBezier(a, b, c, d, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * a.x + 3 * mt * mt * t * b.x + 3 * mt * t * t * c.x + t * t * t * d.x,
      y: mt * mt * mt * a.y + 3 * mt * mt * t * b.y + 3 * mt * t * t * c.y + t * t * t * d.y,
    };
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function emitNote() {
    if (!els.particleLayer) {
      return;
    }
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = pick(['\u266A', '\u266B', '\u2669']);
    note.style.left = `${random(43, 58)}%`;
    note.style.setProperty('--note-drift', `${random(-34, 34)}px`);
    els.particleLayer.appendChild(note);
    state.projectileNodes.add(note);
    setVariantTimeout(() => {
      note.remove();
      state.projectileNodes.delete(note);
    }, 2500);
  }

  function startNoteSmoke() {
    emitNote();
    setVariantInterval(emitNote, 820);
  }

  function clearProjectiles() {
    state.projectileNodes.forEach((node) => node.remove());
    state.projectileNodes.clear();
  }

  function removeTrackedParticle(particle) {
    if (particle.removed) {
      return;
    }
    particle.removed = true;
    particle.node.remove();
    state.projectileNodes.delete(particle.node);
  }

  function createStarNode(metrics, sizeScale = 1) {
    const colorThemes = [
      { inner: '#ff6666', outer: '#ff0000' },
      { inner: '#ffc266', outer: '#ff8c00' },
      { inner: '#e680ff', outer: '#aa00ff' },
      { inner: '#ffffff', outer: '#ffd24b' },
    ];
    const node = document.createElement('div');
    const theme = pick(colorThemes);
    node.className = 'star-particle';
    node.style.opacity = '0';
    node.style.transition = 'none';
    node.style.setProperty('--star-inner', theme.inner);
    node.style.setProperty('--star-outer', theme.outer);
    node.style.setProperty('--star-size', `${metrics.starSize * sizeScale}px`);
    els.particleLayer.appendChild(node);
    state.projectileNodes.add(node);
    return node;
  }

  function emitBurst(center, options = {}) {
    if (!els.particleLayer) {
      return 0;
    }

    const metrics = particleMetrics();
    const count = options.count ?? 22;
    const duration = options.duration ?? 820;
    const minRadius = (options.minRadius ?? 20) * metrics.stageScale;
    const maxRadius = (options.maxRadius ?? 62) * metrics.stageScale;
    const gravity = (options.gravity ?? 14) * metrics.stageScale;
    const sizeScale = options.sizeScale ?? 0.86;
    const particles = [];

    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + random(-0.22, 0.22);
      const radius = random(minRadius, maxRadius);
      const node = createStarNode(metrics, random(0.58, 1.05) * sizeScale);
      particles.push({
        node,
        x: center.x,
        y: center.y,
        dx: Math.cos(angle) * radius,
        dy: Math.sin(angle) * radius - random(2, 18) * metrics.stageScale,
        spin: random(-180, 180),
        baseScale: random(0.72, 1.22),
        opacityScale: random(0.72, 1),
        removed: false,
      });
    }

    const started = performance.now();
    function frame(time) {
      const t = clamp((time - started) / duration, 0, 1);
      const ease = easeOutCubic(t);
      const opacity = Math.sin((1 - t) * Math.PI * 0.5);

      particles.forEach((particle) => {
        if (particle.removed) {
          return;
        }
        const x = particle.x + particle.dx * ease;
        const y = particle.y + particle.dy * ease + gravity * t * t;
        const scale = particle.baseScale * (1 + 0.2 * Math.sin(t * Math.PI));
        particle.node.style.opacity = String(opacity * particle.opacityScale);
        particle.node.style.transform = [
          `translate(${x}px, ${y}px)`,
          'translate(-50%, -50%)',
          `scale(${scale})`,
          `rotate(${particle.spin * ease}deg)`,
        ].join(' ');
      });

      if (t < 1) {
        ctx.requestFrame(frame);
      } else {
        particles.forEach(removeTrackedParticle);
      }
    }

    ctx.requestFrame(frame);
    return duration;
  }

  function fireButtonBurstAt(target) {
    const buttonDuration = emitBurst(centerOf(target), {
      count: 26,
      duration: 840,
      minRadius: 24,
      maxRadius: 78,
      gravity: 20,
      sizeScale: 0.82,
    });
    emitBurst(magicStartPoint(), {
      count: 8,
      duration: 540,
      minRadius: 8,
      maxRadius: 24,
      gravity: 4,
      sizeScale: 0.58,
    });
    return buttonDuration;
  }

  function fireMagicAt(target, options = {}) {
    if (!els.particleLayer || !target) {
      return 0;
    }

    if (options.effect === 'button-burst') {
      return fireButtonBurstAt(target);
    }

    const metrics = particleMetrics();
    const start = magicStartPoint();
    const end = centerOf(target);
    const control1 = {
      x: start.x + (end.x - start.x) * 0.3 + random(-metrics.controlDriftX, metrics.controlDriftX),
      y: start.y + (end.y - start.y) * 0.3 - random(metrics.controlDriftYMin, metrics.controlDriftYMax),
    };
    const control2 = {
      x: start.x + (end.x - start.x) * 0.7 + random(-metrics.controlDriftX, metrics.controlDriftX),
      y: start.y + (end.y - start.y) * 0.7 - random(metrics.controlDriftYMin, metrics.controlDriftYMax),
    };
    const points = [];
    const noiseFreq = random(2, 4);
    const noiseAmp = random(metrics.noiseMin, metrics.noiseMax);
    const trailLife = 0.5;
    const targetCullStart = 0.58;
    const colorThemes = [
      { inner: '#ff6666', outer: '#ff0000' },
      { inner: '#ffc266', outer: '#ff8c00' },
      { inner: '#e680ff', outer: '#aa00ff' },
    ];

    function targetProximity(t) {
      if (t <= targetCullStart) {
        return 1;
      }
      return 1 - (t - targetCullStart) / (1 - targetCullStart);
    }

    function removeParticle(particle) {
      if (particle.removed) {
        return;
      }
      particle.removed = true;
      particle.node.remove();
      state.projectileNodes.delete(particle.node);
    }

    for (let i = 0; i <= 30; i += 1) {
      const t = i / 30;
      const basePoint = cubicBezier(start, control1, control2, end, t);
      const dx = Math.sin(t * Math.PI * noiseFreq) * noiseAmp + Math.cos(t * Math.PI * noiseFreq * 2.5) * noiseAmp * 0.6;
      const dy = Math.cos(t * Math.PI * noiseFreq) * noiseAmp + Math.sin(t * Math.PI * noiseFreq * 1.8) * noiseAmp * 0.6;
      const targetFade = targetProximity(t);

      if (targetFade <= 0.08) {
        continue;
      }

      const particles = [];
      const clusterCount = Math.max(1, Math.round(random(2, 5) * targetFade));
      for (let j = 0; j < clusterCount; j += 1) {
        const node = document.createElement('div');
        const theme = pick(colorThemes);
        node.className = 'star-particle';
        node.style.opacity = '0';
        node.style.transition = 'transform 120ms ease-in-out';
        node.style.setProperty('--star-inner', theme.inner);
        node.style.setProperty('--star-outer', theme.outer);
        node.style.setProperty('--star-size', `${metrics.starSize}px`);
        els.particleLayer.appendChild(node);
        state.projectileNodes.add(node);
        particles.push({
          node,
          x: basePoint.x + dx,
          y: basePoint.y + dy,
          ox: random(-metrics.offsetMax, metrics.offsetMax),
          oy: random(-metrics.offsetMax, metrics.offsetMax),
          baseScale: random(0.5, 1.15),
          angle: random(0, 360),
          opacityScale: random(0.75, 1),
          removed: false,
        });
      }

      points.push({ t, targetFade, particles });
    }

    const started = performance.now();
    function frame(time) {
      const timeFraction = clamp((time - started) / 1200, 0, 1);
      const currentT = easeOutCubic(timeFraction);

      points.forEach((point, pointIndex) => {
        if (currentT < point.t) {
          return;
        }

        const age = currentT - point.t;
        if (age > trailLife) {
          point.particles.forEach(removeParticle);
          return;
        }

        let opacity = age < 0.06 ? age / 0.06 : 1 - (age - 0.06) / (trailLife - 0.06);
        opacity *= point.targetFade;
        const nearTarget = point.t >= targetCullStart;

        point.particles.forEach((particle) => {
          if (particle.removed) {
            return;
          }

          const finalOpacity = opacity * particle.opacityScale;
          if (finalOpacity < 0.035 || (nearTarget && age > trailLife * 0.35)) {
            removeParticle(particle);
            return;
          }

          particle.node.style.opacity = finalOpacity.toString();
          particle.angle += 3;
          const throb = 1 + 0.2 * Math.sin(time / 100 + pointIndex);
          particle.node.style.transform = [
            `translate(${particle.x + particle.ox}px, ${particle.y + particle.oy}px)`,
            'translate(-50%, -50%)',
            `scale(${particle.baseScale * throb * point.targetFade})`,
            `rotate(${particle.angle}deg)`,
          ].join(' ');
        });
      });

      if (timeFraction < 1) {
        ctx.requestFrame(frame);
      } else {
        ctx.setTimeoutTracked(() => {
          points.forEach((point) => point.particles.forEach(removeParticle));
        }, 120);
      }
    }

    ctx.requestFrame(frame);
    return 1200;
  }

  return {
    emitNote,
    startNoteSmoke,
    clearProjectiles,
    fireMagicAt,
  };
}
