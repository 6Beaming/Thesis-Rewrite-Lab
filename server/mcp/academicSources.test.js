import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROSSREF_LOOKUP_TOOL,
  extractDois,
  lookupAcademicSourcesViaMcp,
  normalizeCrossrefWork,
} from './academicSources.js';

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
    message: 'No Crossref record was found for this DOI.',
  }]);
});
