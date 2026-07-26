export const DEFAULT_SEGMENTATION_POLICY = Object.freeze({
  minChars: 600,
  targetChars: 700,
  maxChars: 800,
  locale: 'en',
});

export function countCharacters(value) {
  return Array.from(String(value ?? '')).length;
}

export function normalizeSegmentationPolicy(options = {}) {
  const targetChars = Math.max(
    1,
    Number(options.targetChars) || DEFAULT_SEGMENTATION_POLICY.targetChars,
  );
  const minChars = Math.min(
    targetChars,
    Math.max(1, Number(options.minChars) || DEFAULT_SEGMENTATION_POLICY.minChars),
  );
  const maxChars = Math.max(
    targetChars,
    Number(options.maxChars) || DEFAULT_SEGMENTATION_POLICY.maxChars,
  );

  return Object.freeze({
    minChars,
    targetChars,
    maxChars,
    locale: String(options.locale || DEFAULT_SEGMENTATION_POLICY.locale),
  });
}
