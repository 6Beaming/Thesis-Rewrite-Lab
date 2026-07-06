import layoutData from './owl-container-layout.json';

export const containerLayout = layoutData;

export function getLayoutVariant(variant) {
  return containerLayout[variant];
}

export function getContainerCssVars(variant) {
  const layout = getLayoutVariant(variant);
  const { layers } = layout;

  return {
    '--owl-aspect-ratio': String(layout.aspectRatio),
    '--owl-indicator-width': layers.indicator.width,
    '--owl-layer-indicator-top': layers.indicator.top,
    '--owl-layer-indicator-height': layers.indicator.height,
    '--owl-layer-owl-top': layers.owl.top,
    '--owl-layer-owl-height': layers.owl.height,
    '--owl-layer-bottom-top': layers.bottom.top,
    '--owl-layer-bottom-height': layers.bottom.height,
  };
}

export function measureMobileContainer() {
  const vw = window.innerWidth;
  const visibleWidth = Math.min(128, vw * 0.3333);
  const fullWidth = visibleWidth / containerLayout.mobileFloating.visibleWidthRatio;
  const aspectRatio = containerLayout.mobile.aspectRatio;
  const height = fullWidth / aspectRatio;
  const minTop = 0;
  const maxTop = Math.max(minTop, window.innerHeight - height);
  const overflowLeft = fullWidth * containerLayout.mobileFloating.hiddenOverflowRatio;

  return {
    visibleWidth,
    fullWidth,
    height,
    minTop,
    maxTop,
    snapLeft: -overflowLeft,
    aspectRatio,
  };
}

export function getMobileContainerCssVars(metrics) {
  return {
    ...getContainerCssVars('mobile'),
    '--owl-container-width': `${metrics.fullWidth}px`,
    '--owl-container-height': `${metrics.height}px`,
    '--owl-visible-width': `${metrics.visibleWidth}px`,
  };
}

export function getBlackboardCssVars() {
  const { naturalWidth, naturalHeight, maxWidth } = containerLayout.blackboard;
  return {
    '--blackboard-max-width': maxWidth,
    '--blackboard-natural-width': String(naturalWidth),
    '--blackboard-natural-height': String(naturalHeight),
  };
}
