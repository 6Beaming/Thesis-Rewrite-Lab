import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReferenceString } from '../mcp/tools/parseReferenceString.js';
import { renderCitationStyle } from '../mcp/tools/renderCitationStyle.js';
import {
  planCitationStyleConversion,
  runCitationCheck,
} from './workflowRouter.js';
import { validateCitationAnchor } from './citationAnchors.js';

test('reference parsing and rendering are deterministic and versioned', () => {
  const parsed = parseReferenceString({
    rawReferenceText: 'Jane Smith. (2020). A Useful Study. Journal. https://doi.org/10.1000/test',
  });
  assert.equal(parsed.metadata.year, '2020');
  assert.equal(parsed.metadata.doi, '10.1000/test');
  const rendered = renderCitationStyle({
    metadata: parsed.metadata,
    styleName: 'APA7',
    mode: 'inline',
  });
  assert.equal(rendered.text, '(Smith, 2020)');
  assert.equal(rendered.rendererVersion, 'citation-renderer-v2');

  const organization = parseReferenceString({
    rawReferenceText: 'Weill Cornell Medicine. (2024). A Useful Study. ScienceDaily.',
  });
  assert.equal(renderCitationStyle({
    metadata: organization.metadata,
    styleName: 'APA7',
    mode: 'inline',
  }).text, '(Weill Cornell Medicine, 2024)');
});

test('citation checks return block-relative anchors and stale validation fails closed', () => {
  const blocks = [
    {
      id: 'block-a',
      text_content: 'Prior work supports this claim (Smith, 2020).',
      partition_generation: 3,
    },
    {
      id: 'block-b',
      text_content: 'References',
      partition_generation: 0,
    },
    {
      id: 'block-c',
      text_content: 'Smith, Jane. (2020). Prior work.',
      partition_generation: 0,
    },
  ];
  const result = runCitationCheck({
    documentId: 'document-a',
    revision: 7,
    partitionRevision: 2,
    blocks,
  });
  assert.equal(result.inlineCitations.length, 1);
  assert.equal(result.inlineCitations[0].anchor.blockId, 'block-a');
  assert.equal(
    validateCitationAnchor(blocks[0], result.inlineCitations[0].anchor).ok,
    true,
  );
  assert.equal(
    validateCitationAnchor(
      { ...blocks[0], text_content: `${blocks[0].text_content} changed` },
      result.inlineCitations[0].anchor,
    ).code,
    'STALE_CITATION_ANCHOR',
  );
});

test('bibliography completion and orphan recommendation remain explicit and evidence based', () => {
  const completion = runCitationCheck({
    documentId: 'document-b',
    revision: 1,
    partitionRevision: 0,
    blocks: [{
      id: 'block-inline',
      text_content: 'The model follows prior work (Smith, 2020).',
      partition_generation: 0,
    }],
  });
  assert.equal(completion.workflow, 'bibliography-completion');
  assert.equal(completion.appendAnchor.originalText, '');

  const orphaned = runCitationCheck({
    documentId: 'document-c',
    revision: 1,
    partitionRevision: 0,
    blocks: [
      {
        id: 'claim',
        text_content: 'The transformer architecture demonstrates strong transformer performance.',
        partition_generation: 0,
      },
      { id: 'heading', text_content: 'References', partition_generation: 0 },
      {
        id: 'reference',
        text_content: 'Smith, Jane. (2020). Transformer architecture performance.',
        partition_generation: 0,
      },
    ],
  });
  assert.ok(orphaned.recommendations[0].candidates.length > 0);
  assert.ok(orphaned.recommendations[0].candidates[0].reasons.includes('claim-signal'));
});

test('fragmented reference blocks regroup by source paragraph and match every in-text source', () => {
  const blocks = [
    {
      id: 'claim',
      text_content: 'The sources agree (Scott et al., 2022; Weill Cornell Medicine, 2024).',
      partition_generation: 0,
      attrs: { paragraphIndex: 0, sourceType: 'paragraph' },
    },
    {
      id: 'heading',
      text_content: 'References',
      partition_generation: 0,
      attrs: { paragraphIndex: 1, sourceType: 'bibliographyHeading' },
    },
    {
      id: 'scott-a',
      text_content: 'Scott, A. J., Bisby, M. A. ',
      partition_generation: 0,
      attrs: { paragraphIndex: 2, sourceType: 'bibliographyEntry' },
    },
    {
      id: 'scott-b',
      text_content: '(2022). Understanding the untreated course. Journal, 89, 102590.',
      partition_generation: 1,
      attrs: { paragraphIndex: 2, sourceType: 'bibliographyEntry' },
    },
    {
      id: 'weill',
      text_content: 'Weill Cornell Medicine. (2024). Cognitive behavioral therapy app. ScienceDaily.',
      partition_generation: 0,
      attrs: { paragraphIndex: 3, sourceType: 'bibliographyEntry' },
    },
  ];
  const result = runCitationCheck({
    documentId: 'document-d',
    revision: 1,
    partitionRevision: 0,
    blocks,
  });

  assert.equal(result.bibliography.length, 2);
  assert.deepEqual(result.bibliography[0].blockIds, ['scott-a', 'scott-b']);
  assert.match(result.bibliography[0].rawReferenceText, /102590\.$/u);
  assert.equal(result.inlineCitations.length, 2);
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.orphaned.length, 0);
});

test('APA checking links a mistakenly used given name to the unique listed family name', () => {
  const blocks = [
    {
      id: 'body-a',
      text_content: [
        'The media article (Weill Cornell Medicine, 2024) described the app. ',
        'Its primary article (Jennifer et al., 2024) reported the measurements.',
      ].join(''),
      partition_generation: 0,
      attrs: { paragraphIndex: 0, sourceType: 'paragraph' },
    },
    {
      id: 'body-b',
      text_content: [
        'Prior work (Scott et al., 2022, cited by Jennifer et al., 2024) ',
        'was used to discuss spontaneous recovery.',
      ].join(''),
      partition_generation: 0,
      attrs: { paragraphIndex: 1, sourceType: 'paragraph' },
    },
    {
      id: 'references',
      text_content: 'References',
      partition_generation: 0,
      attrs: { paragraphIndex: 2, sourceType: 'bibliographyHeading' },
    },
    {
      id: 'bress',
      text_content: [
        'Bress, J. N., Falk, A., Schier, M. M., Jaywant, A., Moroney, E., ',
        'Dargis, M., ... & Gunning, F. M. (2024). Efficacy of a mobile ',
        'app-based intervention for young adults with anxiety disorders: ',
        'a randomized clinical trial. JAMA network open, 7(8), e2428372-e2428372.',
      ].join(''),
      partition_generation: 0,
      attrs: { paragraphIndex: 3, sourceType: 'bibliographyEntry' },
    },
    {
      id: 'scott',
      text_content: [
        'Scott, A. J., Bisby, M. A., Heriseanu, A. I., Hathway, T., Karin, E., ',
        'Gandy, M., ... & Dear, B. F. (2022). Understanding the untreated ',
        'course of anxiety disorders. Journal of anxiety disorders, 89, 102590.',
      ].join(''),
      partition_generation: 0,
      attrs: { paragraphIndex: 4, sourceType: 'bibliographyEntry' },
    },
    {
      id: 'weill',
      text_content: [
        'Weill Cornell Medicine. (2024, August 20). Cognitive behavioral ',
        'therapy app improves anxiety in young adults. ScienceDaily.',
      ].join(''),
      partition_generation: 0,
      attrs: { paragraphIndex: 5, sourceType: 'bibliographyEntry' },
    },
  ];

  const result = runCitationCheck({
    documentId: 'document-test-assignment',
    revision: 1,
    partitionRevision: 0,
    blocks,
    styleName: 'APA7',
  });

  assert.equal(result.inlineCitations.length, 4);
  assert.equal(result.bibliography.length, 3);
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.orphaned.length, 0);
  assert.equal(result.formattingIssues.length, 2);
  assert.deepEqual(
    result.formattingIssues.map((issue) => issue.replacementText),
    [
      '(Bress et al., 2024)',
      '(Scott et al., 2022, as cited in Bress et al., 2024)',
    ],
  );
  assert.ok(result.formattingIssues[0].reasonCodes.includes(
    'given-name-used-instead-of-family-name',
  ));
  assert.ok(result.formattingIssues[1].reasonCodes.includes(
    'given-name-used-instead-of-family-name',
  ));
  assert.ok(result.formattingIssues[1].reasonCodes.includes(
    'secondary-source-connector',
  ));
  assert.equal(
    result.bibliography.find((entry) => entry.blockId === 'weill').expectedInlineCitation,
    '(Weill Cornell Medicine, 2024)',
  );

  const mlaConversion = planCitationStyleConversion({
    documentId: 'document-test-assignment',
    revision: 1,
    partitionRevision: 0,
    blocks,
    sourceStyleName: 'APA7',
    targetStyleName: 'MLA9',
  });
  assert.equal(mlaConversion.verification.inlineCitations.length, 4);
  assert.equal(mlaConversion.verification.formattingIssues.length, 0);
  assert.equal(mlaConversion.verification.unresolved.length, 0);
  assert.equal(mlaConversion.verification.orphaned.length, 0);
  assert.ok(mlaConversion.inlineChanges.some(
    (change) => change.replacementText === '(Scott et al., qtd. in Bress et al.)',
  ));
});

test('citation formatting is checked before missing and unused source totals', () => {
  const result = runCitationCheck({
    documentId: 'document-format-order',
    revision: 1,
    partitionRevision: 0,
    styleName: 'APA7',
    blocks: [
      {
        id: 'body',
        text_content: 'The result was reproduced (Smith 2020).',
        partition_generation: 0,
      },
      {
        id: 'heading',
        text_content: 'References',
        partition_generation: 0,
      },
      {
        id: 'smith',
        text_content: 'Smith, J. (2020). A reproducible result. Research Journal.',
        partition_generation: 0,
      },
    ],
  });

  assert.equal(result.formattingIssues.length, 1);
  assert.equal(result.formattingIssues[0].replacementText, '(Smith, 2020)');
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.orphaned.length, 0);
});

test('template conversion formats bibliography first and then rechecks in-text citations', () => {
  const apaBlocks = [
    {
      id: 'body',
      text_content: 'The result was reproduced (Smith, 2020, p. 42).',
      partition_generation: 0,
      attrs: { paragraphIndex: 0, sourceType: 'paragraph' },
    },
    {
      id: 'heading',
      text_content: 'References',
      partition_generation: 0,
      attrs: { paragraphIndex: 1, sourceType: 'bibliographyHeading' },
    },
    {
      id: 'smith',
      text_content: 'Smith, J. (2020). A useful study. Research Journal, 4(2), 1-9.',
      partition_generation: 0,
      attrs: { paragraphIndex: 2, sourceType: 'bibliographyEntry' },
    },
  ];
  const toMla = planCitationStyleConversion({
    documentId: 'document-template-conversion',
    revision: 4,
    partitionRevision: 1,
    blocks: apaBlocks,
    sourceStyleName: 'APA7',
    targetStyleName: 'MLA9',
  });

  assert.deepEqual(toMla.phases.map((phase) => phase.name), ['bibliography', 'inline']);
  assert.match(toMla.bibliographyChanges[0].replacementText, /"A useful study\."/u);
  assert.equal(toMla.inlineChanges[0].replacementText, '(Smith 42)');
  assert.equal(toMla.verification.formattingIssues.length, 0);
  assert.equal(toMla.verification.unresolved.length, 0);
  assert.equal(toMla.verification.orphaned.length, 0);

  const toApa = planCitationStyleConversion({
    documentId: 'document-template-conversion',
    revision: 5,
    partitionRevision: 1,
    sourceStyleName: 'MLA9',
    targetStyleName: 'APA7',
    blocks: [
      { ...apaBlocks[0], text_content: 'The result was reproduced (Smith 42).' },
      { ...apaBlocks[1], text_content: 'Works Cited' },
      { ...apaBlocks[2], text_content: toMla.bibliographyChanges[0].replacementText },
    ],
  });
  assert.match(toApa.bibliographyChanges[0].replacementText, /\(2020\)\./u);
  assert.equal(toApa.inlineChanges[0].replacementText, '(Smith, 2020, p. 42)');
  assert.equal(toApa.verification.formattingIssues.length, 0);
});
