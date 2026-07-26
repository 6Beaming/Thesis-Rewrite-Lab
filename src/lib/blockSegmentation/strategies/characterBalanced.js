import { countCharacters } from '../policy.js';
import { sentenceRanges } from '../sentences.js';

function rangeLength(source, start, end) {
  return countCharacters(source.slice(start, end));
}

function createBlock(source, first, last, boundaryReason) {
  return {
    text: source.slice(first.start, last.end),
    start: first.start,
    end: last.end,
    boundaryReason,
  };
}

export function characterBalancedStrategy(source, section, policy) {
  const sentences = sentenceRanges(source, {
    start: section.start,
    end: section.end,
    locale: policy.locale,
  });
  if (!sentences.length) return [];

  const blocks = [];
  let current = [];

  function finish(reason) {
    if (!current.length) return;
    blocks.push(createBlock(source, current[0], current.at(-1), reason));
    current = [];
  }

  for (const sentence of sentences) {
    const sentenceLength = rangeLength(source, sentence.start, sentence.end);
    if (sentenceLength > policy.maxChars) {
      finish('max');
      current = [sentence];
      finish('oversized-sentence');
      continue;
    }

    if (!current.length) {
      current.push(sentence);
      continue;
    }

    const currentLength = rangeLength(source, current[0].start, current.at(-1).end);
    const projectedLength = rangeLength(source, current[0].start, sentence.end);
    if (projectedLength > policy.maxChars) {
      finish('max');
      current.push(sentence);
      continue;
    }

    if (currentLength >= policy.minChars && projectedLength > policy.targetChars) {
      const currentDistance = Math.abs(policy.targetChars - currentLength);
      const projectedDistance = Math.abs(projectedLength - policy.targetChars);
      if (currentDistance <= projectedDistance) {
        finish('target');
      }
    }
    current.push(sentence);
  }

  finish(section.followedByHardBoundary ? 'hard-boundary' : 'document-end');

  if (blocks.length > 1) {
    const tail = blocks.at(-1);
    const previous = blocks.at(-2);
    if (
      tail.boundaryReason === 'document-end'
      && countCharacters(tail.text) < policy.minChars
      && countCharacters(source.slice(previous.start, tail.end)) <= policy.maxChars
      && previous.boundaryReason !== 'oversized-sentence'
    ) {
      blocks.splice(-2, 2, {
        text: source.slice(previous.start, tail.end),
        start: previous.start,
        end: tail.end,
        boundaryReason: 'document-end',
      });
    }
  }

  return blocks;
}
