import { stableFingerprint } from '../nlp/hash.js';
import { extractInlineCitations } from './extractInlineCitations.js';
import { extractBibliography } from './extractBibliography.js';
import { parseReferenceString } from '../mcp/tools/parseReferenceString.js';
import { renderCitationStyle } from '../mcp/tools/renderCitationStyle.js';
import { createCitationAnchor } from './citationAnchors.js';

export const CITATION_WORKFLOW_VERSION = 'citation-workflow-v4';

export function citationStyleFromAcademicStyle(academicStyle) {
  if (academicStyle === 'MLA') return 'MLA9';
  if (academicStyle === 'Chicago') return 'Chicago';
  return 'APA7';
}

function inlineKey(citation) {
  return `${citation.authorKey ?? ''}|${citation.year ?? ''}`;
}

function referenceAuthorKey(parsed) {
  return parsed.metadata.authorFamilyNames?.[0]
    ?? parsed.metadata.authors[0]?.split(/\s+/u).at(-1)?.toLocaleLowerCase('en')
    ?? '';
}

function referenceKey(parsed) {
  return `${referenceAuthorKey(parsed)}|${parsed.metadata.year ?? ''}`;
}

function comparableCitation(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[’]/gu, "'")
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,)])/gu, '$1')
    .replace(/([([])\s+/gu, '$1')
    .trim()
    .toLocaleLowerCase('en');
}

function expectedInlineParts(reference) {
  const text = reference.expectedInlineCitation;
  const parentheticalPart = /^\((.*)\)$/u.exec(text)?.[1] ?? text;
  const year = reference.parsed.metadata.year;
  const author = year
    ? parentheticalPart.replace(new RegExp(`,\\s*${year.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'iu'), '')
    : parentheticalPart;
  return {
    parenthetical: parentheticalPart,
    narrative: year ? `${author} (${year})` : author,
  };
}

function citationPageLocator(citation) {
  const text = String(citation.partText ?? '');
  const afterAuthorAndYear = citation.kind !== 'author-page' && citation.year
    ? text.slice((text.toLocaleLowerCase('en').indexOf(citation.year) + citation.year.length))
    : text.slice(String(citation.authorLabel ?? '').length);
  return afterAuthorAndYear.match(
    /(?:^|[,\s])(?:p{1,2}\.\s*)?(\d+(?:\s*[-–]\s*\d+)?)\b/iu,
  )?.[1]?.replace(/\s+/gu, '') ?? null;
}

function citationExpectedText(citation, reference) {
  const parts = expectedInlineParts(reference);
  if (citation.presentation === 'narrative') return parts.narrative;
  const locator = citationPageLocator(citation);
  if (!locator) return parts.parenthetical;
  if (reference.citationStyleName === 'MLA9') {
    return `${parts.parenthetical} ${locator}`;
  }
  return `${parts.parenthetical}, p. ${locator}`;
}

function citationIsFormatted(citation, reference) {
  return comparableCitation(citation.partText)
    === comparableCitation(citationExpectedText(citation, reference));
}

function firstAuthorInitial(reference) {
  return reference.parsed.metadata.authorInitials?.[0] ?? null;
}

function findGivenNameCorrection(citation, references) {
  const sameYear = references.filter((reference) => (
    String(reference.parsed.metadata.year ?? '') === String(citation.year ?? '')
  ));
  const initialMatches = sameYear.filter((reference) => (
    firstAuthorInitial(reference)
    && citation.authorKey?.[0]?.toLocaleLowerCase('en') === firstAuthorInitial(reference)
    && citation.authorKey !== reference.authorKey
  ));
  return initialMatches.length === 1 ? initialMatches[0] : null;
}

function issueAnchorKey(citation) {
  return [
    citation.anchor.blockId,
    citation.anchor.citationStartCp,
    citation.anchor.citationEndCp,
  ].join('|');
}

function compileFormattingIssues(rawIssues, styleName) {
  const grouped = new Map();
  for (const raw of rawIssues) {
    const key = issueAnchorKey(raw.citation);
    if (!grouped.has(key)) {
      grouped.set(key, {
        anchor: raw.citation.anchor,
        originalText: raw.citation.anchor.originalText,
        citations: [],
        references: [],
        replacements: [],
        reasons: new Set(),
      });
    }
    const entry = grouped.get(key);
    const offset = raw.citation.presentation === 'parenthetical' ? 1 : 0;
    entry.citations.push(raw.citation);
    entry.references.push(raw.reference);
    const replacement = {
      start: offset + raw.citation.partStart,
      end: offset + raw.citation.partEnd,
      text: citationExpectedText(raw.citation, raw.reference),
    };
    if (!entry.replacements.some((existing) => (
      existing.start === replacement.start
      && existing.end === replacement.end
    ))) {
      entry.replacements.push(replacement);
    }
    entry.reasons.add(raw.reason);
  }

  return [...grouped.values()].map((entry) => {
    let replacementText = entry.originalText;
    for (const replacement of [...entry.replacements].sort((left, right) => right.start - left.start)) {
      replacementText = [
        replacementText.slice(0, replacement.start),
        replacement.text,
        replacementText.slice(replacement.end),
      ].join('');
    }
    if (entry.reasons.has('secondary-source-connector')) {
      const connector = styleName === 'MLA9'
        ? ', qtd. in '
        : styleName === 'APA7'
          ? ', as cited in '
          : ', quoted in ';
      replacementText = replacementText.replace(
        /,\s*(?:as\s+cited\s+in|cited\s+by|qtd\.\s+in|quoted\s+in)\s+/iu,
        connector,
      );
    }
    const references = [...new Map(entry.references.map((reference) => (
      [reference.blockId, reference]
    ))).values()];
    return {
      anchor: entry.anchor,
      originalText: entry.originalText,
      replacementText,
      styleName,
      reasonCodes: [...entry.reasons],
      citations: entry.citations,
      references,
      metadata: references[0]?.parsed.metadata ?? {},
      title: references[0]?.parsed.metadata.title ?? null,
    };
  });
}

function meaningfulTokens(value) {
  return new Set(
    (String(value ?? '').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((token) => token.length >= 4),
  );
}

function recommendationScore(reference, block) {
  const referenceTokens = meaningfulTokens(reference.parsed.metadata.title);
  const blockTokens = meaningfulTokens([
    block.text_content,
    ...(block.semantic_anchor?.topicTerms ?? []),
  ].join(' '));
  if (!referenceTokens.size || !blockTokens.size) return 0;
  return [...referenceTokens].filter((token) => blockTokens.has(token)).length
    / referenceTokens.size;
}

function orphanRecommendations(orphaned, blocks, bibliographyIds) {
  return orphaned.map((reference) => ({
    blockId: reference.blockId,
    candidates: blocks
      .filter((block) => (
        !bibliographyIds.has(block.id)
        && /\b(?:argu|demonstrat|find|indicat|report|show|suggest|support)\w*\b/iu
          .test(block.text_content)
        && !/(?:\([A-Z][\p{L}'-]+[^)]*\d{4}\)|\[\d+\])/u.test(block.text_content)
      ))
      .map((block) => ({
        blockId: block.id,
        score: Number(recommendationScore(reference, block).toFixed(3)),
        evidence: block.text_content.slice(0, 240),
        reasons: ['claim-signal', 'no-existing-citation', 'reference-title-overlap'],
      }))
      .filter((candidate) => candidate.score >= 0.18)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3),
  }));
}

export function runCitationCheck({
  documentId,
  revision,
  partitionRevision,
  blocks,
  styleName = 'APA7',
}) {
  const bibliography = extractBibliography(blocks).map((entry, index) => {
    const parsed = parseReferenceString({ rawReferenceText: entry.rawReferenceText });
    let expectedInlineCitation = null;
    try {
      expectedInlineCitation = renderCitationStyle({
        metadata: parsed.metadata,
        styleName,
        mode: 'inline',
      }).text;
    } catch {
      expectedInlineCitation = null;
    }
    return {
      ...entry,
      index,
      parsed,
      authorKey: referenceAuthorKey(parsed),
      expectedInlineCitation,
      citationStyleName: styleName,
    };
  });
  const extractedCitations = extractInlineCitations(
    documentId,
    blocks,
    { references: bibliography },
  );
  const referencesByKey = new Map(bibliography.map((entry) => (
    [referenceKey(entry.parsed), entry]
  )));
  const usedReferenceIds = new Set();
  const rawFormattingIssues = [];
  const unresolved = [];
  const inlineCitations = extractedCitations.map((citation) => {
    let reference = referencesByKey.get(inlineKey(citation)) ?? null;
    let reason = 'citation-format';
    if (!reference) {
      reference = findGivenNameCorrection(citation, bibliography);
      reason = 'given-name-used-instead-of-family-name';
    }
    if (!reference) {
      const result = { ...citation, citationStatus: 'missing-source' };
      unresolved.push(result);
      return result;
    }

    usedReferenceIds.add(reference.blockId);
    const formatted = reference.expectedInlineCitation
      ? citationIsFormatted(citation, reference)
      : true;
    const result = {
      ...citation,
      citationStatus: formatted ? 'matched' : 'format-change',
      matchedReferenceBlockId: reference.blockId,
      expectedInlineCitation: reference.expectedInlineCitation,
    };
    const secondaryConnector = citation.anchor.originalText.match(
      /,\s*(as\s+cited\s+in|cited\s+by|qtd\.\s+in|quoted\s+in)\s+/iu,
    )?.[1]?.toLocaleLowerCase('en') ?? null;
    const expectedConnector = styleName === 'MLA9'
      ? 'qtd. in'
      : styleName === 'APA7'
        ? 'as cited in'
        : 'quoted in';
    const secondaryConnectorIssue = Boolean(
      secondaryConnector && secondaryConnector !== expectedConnector,
    );
    if (
      !formatted
      || reason === 'given-name-used-instead-of-family-name'
      || secondaryConnectorIssue
    ) {
      rawFormattingIssues.push({
        citation: result,
        reference,
        reason: secondaryConnectorIssue ? 'secondary-source-connector' : reason,
      });
      if (
        secondaryConnectorIssue
        && reason === 'given-name-used-instead-of-family-name'
      ) {
        rawFormattingIssues.push({
          citation: result,
          reference,
          reason,
        });
      }
    }
    return result;
  });
  const formattingIssues = compileFormattingIssues(rawFormattingIssues, styleName);
  const orphaned = bibliography.filter((entry) => !usedReferenceIds.has(entry.blockId));
  const workflow = bibliography.length
    ? 'alignment'
    : inlineCitations.length
      ? 'bibliography-completion'
      : 'orphan-recommendation';
  const lastBlock = blocks.at(-1);
  const appendAnchor = workflow === 'bibliography-completion' && lastBlock
    ? createCitationAnchor({
      documentId,
      block: lastBlock,
      citationStartCp: Array.from(lastBlock.text_content).length,
      citationEndCp: Array.from(lastBlock.text_content).length,
      originalText: '',
    })
    : null;
  const bibliographyIds = new Set(bibliography.flatMap((entry) => (
    entry.blockIds?.length ? entry.blockIds : [entry.blockId]
  )));
  const recommendations = orphanRecommendations(orphaned, blocks, bibliographyIds);
  return {
    workflow,
    workflowVersion: CITATION_WORKFLOW_VERSION,
    styleName,
    identity: { documentId, revision, partitionRevision },
    inlineCitations,
    bibliography,
    formattingIssues,
    unresolved,
    orphaned,
    appendAnchor,
    recommendations,
    requestFingerprint: stableFingerprint({
      workflowVersion: CITATION_WORKFLOW_VERSION,
      styleName,
      revision,
      partitionRevision,
      inline: inlineCitations.map((item) => ({
        text: item.text,
        partText: item.partText,
        status: item.citationStatus,
      })),
      bibliography: bibliography.map((item) => item.rawReferenceText),
    }),
  };
}

function splitReferenceAcrossBlocks(text, sourceBlocks) {
  if (sourceBlocks.length <= 1) return [text];
  const sourceLength = sourceBlocks.reduce(
    (total, block) => total + Array.from(String(block.text_content ?? '')).length,
    0,
  ) || sourceBlocks.length;
  const output = [];
  let remaining = text;
  let remainingWeight = sourceLength;
  for (let index = 0; index < sourceBlocks.length - 1; index += 1) {
    const weight = Math.max(1, Array.from(String(sourceBlocks[index].text_content ?? '')).length);
    const ideal = Math.max(1, Math.round((remaining.length * weight) / remainingWeight));
    const after = remaining.slice(ideal).search(/\s/u);
    const before = remaining.slice(0, ideal).lastIndexOf(' ');
    const cut = after >= 0
      ? ideal + after + 1
      : before > 0
        ? before + 1
        : ideal;
    output.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
    remainingWeight -= weight;
  }
  output.push(remaining);
  return output;
}

function applyWholeBlockChanges(blocks, changes) {
  const byId = new Map(changes.map((change) => [change.blockId, change.replacementText]));
  return blocks.map((block) => (
    byId.has(block.id)
      ? { ...block, text_content: byId.get(block.id) }
      : block
  ));
}

function applyAnchoredChanges(blocks, changes) {
  const changesByBlock = new Map();
  for (const change of changes) {
    if (!changesByBlock.has(change.blockId)) changesByBlock.set(change.blockId, []);
    changesByBlock.get(change.blockId).push(change);
  }
  return blocks.map((block) => {
    const blockChanges = changesByBlock.get(block.id);
    if (!blockChanges?.length) return block;
    let points = Array.from(block.text_content);
    for (const change of [...blockChanges].sort(
      (left, right) => right.anchor.citationStartCp - left.anchor.citationStartCp,
    )) {
      points = [
        ...points.slice(0, change.anchor.citationStartCp),
        ...Array.from(change.replacementText),
        ...points.slice(change.anchor.citationEndCp),
      ];
    }
    return { ...block, text_content: points.join('') };
  });
}

export function planCitationStyleConversion({
  documentId,
  revision,
  partitionRevision,
  blocks,
  sourceStyleName = 'APA7',
  targetStyleName,
}) {
  if (!['APA7', 'MLA9', 'Chicago'].includes(targetStyleName)) {
    throw new Error('A supported citation style is required.');
  }
  const sourceCheck = runCitationCheck({
    documentId,
    revision,
    partitionRevision,
    blocks,
    styleName: sourceStyleName,
  });
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const bibliographyChanges = [];
  for (const reference of sourceCheck.bibliography) {
    let rendered;
    try {
      rendered = renderCitationStyle({
        metadata: reference.parsed.metadata,
        styleName: targetStyleName,
        mode: 'bibliography',
      }).text;
    } catch {
      continue;
    }
    const sourceBlocks = (reference.blockIds ?? [reference.blockId])
      .map((blockId) => blocksById.get(blockId))
      .filter(Boolean);
    const fragments = splitReferenceAcrossBlocks(rendered, sourceBlocks);
    sourceBlocks.forEach((block, index) => {
      if (block.text_content === fragments[index]) return;
      bibliographyChanges.push({
        phase: 'bibliography',
        blockId: block.id,
        originalText: block.text_content,
        replacementText: fragments[index],
      });
    });
  }

  const bibliographyFirstBlocks = applyWholeBlockChanges(blocks, bibliographyChanges);
  const targetCheck = runCitationCheck({
    documentId,
    revision,
    partitionRevision,
    blocks: bibliographyFirstBlocks,
    styleName: targetStyleName,
  });
  const inlineChanges = targetCheck.formattingIssues.map((issue) => ({
    phase: 'inline',
    blockId: issue.anchor.blockId,
    anchor: issue.anchor,
    originalText: issue.originalText,
    replacementText: issue.replacementText,
  }));
  const convertedBlocks = applyAnchoredChanges(bibliographyFirstBlocks, inlineChanges);
  const verification = runCitationCheck({
    documentId,
    revision,
    partitionRevision,
    blocks: convertedBlocks,
    styleName: targetStyleName,
  });
  return {
    workflowVersion: CITATION_WORKFLOW_VERSION,
    sourceStyleName,
    targetStyleName,
    phases: [
      { name: 'bibliography', changes: bibliographyChanges },
      { name: 'inline', changes: inlineChanges },
    ],
    bibliographyChanges,
    inlineChanges,
    verification,
  };
}
