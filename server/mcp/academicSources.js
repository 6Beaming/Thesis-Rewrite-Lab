import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const ACADEMIC_SOURCES_MCP_SERVER = 'thesis-rewriter-academic-sources';
export const CROSSREF_LOOKUP_TOOL = 'lookup_crossref_doi';
export const MAX_CROSSREF_DOIS_PER_BLOCK = 3;

const DOI_PATTERN = /10\.\d{4,9}\/[\-._;()/:a-z0-9]+/gi;
const DEFAULT_CROSSREF_TIMEOUT_MS = 5_000;

function trimDoiPunctuation(value) {
  let normalized = String(value ?? '').trim().replace(/[.,;:!?]+$/g, '');
  while (
    normalized.endsWith(')')
    && (normalized.match(/\)/g)?.length ?? 0) > (normalized.match(/\(/g)?.length ?? 0)
  ) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

export function extractDois(text) {
  const matches = String(text ?? '').match(DOI_PATTERN) ?? [];
  return [...new Set(matches.map(trimDoiPunctuation).filter(Boolean))]
    .slice(0, MAX_CROSSREF_DOIS_PER_BLOCK);
}

function firstText(value) {
  if (Array.isArray(value)) return String(value.find(Boolean) ?? '').trim();
  return String(value ?? '').trim();
}

function publishedYear(work) {
  const dateParts = work?.published?.['date-parts']
    ?? work?.['published-print']?.['date-parts']
    ?? work?.['published-online']?.['date-parts']
    ?? work?.issued?.['date-parts'];
  const year = Number(dateParts?.[0]?.[0]);
  return Number.isInteger(year) ? year : null;
}

export function normalizeCrossrefWork(work, requestedDoi) {
  const doi = trimDoiPunctuation(work?.DOI || requestedDoi);
  const authors = Array.isArray(work?.author)
    ? work.author
      .map((author) => [author?.given, author?.family].filter(Boolean).join(' ').trim())
      .filter(Boolean)
      .slice(0, 8)
    : [];

  return {
    doi,
    title: firstText(work?.title) || 'Untitled Crossref record',
    authors,
    publishedYear: publishedYear(work),
    publisher: firstText(work?.publisher) || null,
    containerTitle: firstText(work?.['container-title']) || null,
    workType: firstText(work?.type) || null,
    doiUrl: `https://doi.org/${doi}`,
  };
}

function crossrefTimeoutMs() {
  const configured = Number(process.env.CROSSREF_TIMEOUT_MS || DEFAULT_CROSSREF_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_CROSSREF_TIMEOUT_MS;
  return Math.min(Math.max(configured, 1_000), 15_000);
}

export async function fetchCrossrefWork(
  doi,
  {
    fetchImpl = globalThis.fetch,
    contactEmail = process.env.CROSSREF_CONTACT_EMAIL,
    timeoutMs = crossrefTimeoutMs(),
  } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Crossref lookup requires the Fetch API.');
  }

  const normalizedDoi = trimDoiPunctuation(doi);
  const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`);
  if (contactEmail) url.searchParams.set('mailto', contactEmail);

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': `ThesisRewriter/0.1${contactEmail ? ` (mailto:${contactEmail})` : ''}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const error = new Error(
      response.status === 404
        ? 'Crossref does not have a record for this DOI.'
        : 'Crossref metadata is temporarily unavailable.',
    );
    error.statusCode = response.status;
    throw error;
  }

  const payload = await response.json();
  if (!payload?.message || typeof payload.message !== 'object') {
    throw new Error('Crossref returned an invalid metadata record.');
  }
  return normalizeCrossrefWork(payload.message, normalizedDoi);
}

function safeLookupError(error) {
  if (Number(error?.statusCode) === 404) return 'No Crossref record was found for this DOI.';
  return 'Crossref metadata lookup failed.';
}

export function createAcademicSourcesMcpServer({ lookupWork = fetchCrossrefWork } = {}) {
  const server = new McpServer({
    name: ACADEMIC_SOURCES_MCP_SERVER,
    version: '1.0.0',
  });

  server.registerTool(
    CROSSREF_LOOKUP_TOOL,
    {
      title: 'Look up Crossref DOI metadata',
      description: 'Retrieve bibliographic metadata for one DOI from the Crossref REST API.',
      inputSchema: {
        doi: z.string().min(6).max(255).describe('A DOI such as 10.1038/nphys1170'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ doi }) => {
      try {
        const source = await lookupWork(trimDoiPunctuation(doi));
        return {
          content: [{ type: 'text', text: JSON.stringify(source) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({
              doi: trimDoiPunctuation(doi),
              error: safeLookupError(error),
            }),
          }],
        };
      }
    },
  );

  return server;
}

function parseToolPayload(result) {
  const text = result?.content?.find((item) => item?.type === 'text')?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function emptySourceLookup(status = 'not-needed') {
  return {
    protocol: 'MCP',
    server: ACADEMIC_SOURCES_MCP_SERVER,
    provider: 'Crossref',
    tool: CROSSREF_LOOKUP_TOOL,
    status,
    items: [],
    errors: [],
  };
}

export async function lookupAcademicSourcesViaMcp(text, { lookupWork = fetchCrossrefWork } = {}) {
  const dois = extractDois(text);
  if (!dois.length) return emptySourceLookup();

  const sourceLookup = emptySourceLookup('unavailable');
  const server = createAcademicSourcesMcpServer({ lookupWork });
  const client = new Client({
    name: 'thesis-rewriter-analysis-client',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const listedTools = await client.listTools();
    if (!listedTools.tools.some((tool) => tool.name === CROSSREF_LOOKUP_TOOL)) {
      throw new Error('The academic source MCP tool is unavailable.');
    }

    for (const doi of dois) {
      const result = await client.callTool({
        name: CROSSREF_LOOKUP_TOOL,
        arguments: { doi },
      });
      const payload = parseToolPayload(result);

      if (result.isError || !payload || payload.error) {
        sourceLookup.errors.push({
          doi,
          message: payload?.error || 'Crossref metadata lookup failed.',
        });
      } else {
        sourceLookup.items.push(payload);
      }
    }

    if (sourceLookup.items.length === dois.length) sourceLookup.status = 'completed';
    else if (sourceLookup.items.length) sourceLookup.status = 'partial';
    return sourceLookup;
  } catch {
    sourceLookup.errors = dois.map((doi) => ({
      doi,
      message: 'The academic source MCP workflow was unavailable.',
    }));
    return sourceLookup;
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}
