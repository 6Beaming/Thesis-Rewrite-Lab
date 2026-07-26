import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROSSREF_LOOKUP_TOOL,
  extractDois,
  lookupAcademicSourcesViaMcp,
  normalizeCrossrefWork,
} from './academicSources.js';
import { searchLiteratureQuery } from './tools/searchLiteratureQuery.js';

test('extracts unique DOI values without surrounding sentence punctuation', () => {
  assert.deepEqual(
    extractDois('See https://doi.org/10.1038/nphys1170. The DOI 10.1038/nphys1170 is repeated.'),
    ['10.1038/nphys1170'],
  );
  assert.deepEqual(
    extractDois('References (10.1000/example-one) and 10.5555/ABC.DEF.'),
    ['10.1000/example-one', '10.5555/abc.def'],
  );
});

test('normalizes the Crossref fields supplied to analysis', () => {
  assert.deepEqual(normalizeCrossrefWork({
    DOI: '10.1000/EXAMPLE',
    title: ['A useful paper'],
    author: [{ given: 'Ada', family: 'Lovelace' }],
    'published-online': { 'date-parts': [[2024, 2, 1]] },
    publisher: 'Example Press',
    'container-title': ['Example Journal'],
    type: 'journal-article',
  }, '10.1000/example'), {
    doi: '10.1000/example',
    title: 'A useful paper',
    authors: ['Ada Lovelace'],
    publishedYear: 2024,
    publisher: 'Example Press',
    containerTitle: 'Example Journal',
    workType: 'journal-article',
    doiUrl: 'https://doi.org/10.1000/example',
  });
});

test('lists and calls the Crossref lookup tool through an MCP client and server', async () => {
  const calls = [];
  const lookup = await lookupAcademicSourcesViaMcp(
    'The cited study has DOI 10.1000/example.',
    {
      lookupWork: async (doi) => {
        calls.push(doi);
        return {
          doi,
          title: 'MCP test record',
          authors: ['Test Author'],
          publishedYear: 2025,
          publisher: null,
          containerTitle: null,
          workType: 'journal-article',
          doiUrl: `https://doi.org/${doi}`,
        };
      },
    },
  );

  assert.deepEqual(calls, ['10.1000/example']);
  assert.equal(lookup.protocol, 'MCP');
  assert.equal(lookup.tool, CROSSREF_LOOKUP_TOOL);
  assert.equal(lookup.status, 'completed');
  assert.equal(lookup.items[0].title, 'MCP test record');
  assert.deepEqual(lookup.errors, []);
});

test('keeps external-source failures separate from the AI workflow', async () => {
  const lookup = await lookupAcademicSourcesViaMcp(
    'The cited study has DOI 10.1000/missing.',
    {
      lookupWork: async () => {
        const error = new Error('Not found');
        error.statusCode = 404;
        throw error;
      },
    },
  );

  assert.equal(lookup.status, 'unavailable');
  assert.deepEqual(lookup.items, []);
  assert.deepEqual(lookup.errors, [{
    doi: '10.1000/missing',
    message: 'No publication record was found for this DOI.',
  }]);
});

test('literature search strips markup and omits auxiliary figure and reply records', async () => {
  const response = await searchLiteratureQuery({
    query: 'Anderson 2024',
    author: 'Anderson',
    year: '2024',
  }, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        message: {
          items: [
            {
              title: ['Jennifer Anderson on <i>#monalisa</i> and <i>The Act of Becoming</i>'],
              author: [{ given: 'Jennifer', family: 'Anderson' }],
              issued: { 'date-parts': [[2024]] },
              score: 10,
            },
            {
              title: ['Figure 2: Risk of bias assessment'],
              author: [{ given: 'Test', family: 'Author' }],
              issued: { 'date-parts': [[2024]] },
              score: 9,
            },
            {
              title: ['Re: Earlier correspondence'],
              author: [{ given: 'Test', family: 'Author' }],
              issued: { 'date-parts': [[2024]] },
              score: 8,
            },
          ],
        },
      }),
    }),
  });

  assert.equal(response.items.length, 1);
  assert.equal(
    response.items[0].title,
    'Jennifer Anderson on #monalisa and The Act of Becoming',
  );
});
