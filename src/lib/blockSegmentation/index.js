import { consecutiveNewlineBoundaries, sourceSections } from './boundaries.js';
import { normalizeSegmentationPolicy } from './policy.js';
import { characterBalancedStrategy } from './strategies/characterBalanced.js';

export { consecutiveNewlineBoundaries } from './boundaries.js';
export {
  countCharacters,
  DEFAULT_SEGMENTATION_POLICY,
  normalizeSegmentationPolicy,
} from './policy.js';
export { sentenceRanges } from './sentences.js';
export { characterBalancedStrategy } from './strategies/characterBalanced.js';

const STRATEGIES = Object.freeze({
  character: characterBalancedStrategy,
  'character-balanced': characterBalancedStrategy,
});

export function segmentText(source, options = {}) {
  const value = String(source ?? '');
  const policy = normalizeSegmentationPolicy(options);
  const strategy = typeof options.strategy === 'function'
    ? options.strategy
    : STRATEGIES[options.strategy || 'character-balanced'];
  if (!strategy) throw new TypeError(`Unknown segmentation strategy: ${options.strategy}`);

  const hardBoundary = options.hardBoundary || consecutiveNewlineBoundaries;
  return sourceSections(value, hardBoundary)
    .flatMap((section) => strategy(value, section, policy));
}
