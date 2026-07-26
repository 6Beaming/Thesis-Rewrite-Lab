const MAX_RESULTS = 5;
const MAX_PROVIDER_RESULTS = 12;

function firstText(value) {
  const text = Array.isArray(value)
    ? String(value.find(Boolean) ?? '').trim()
    : String(value ?? '').trim();
  return text
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(?:amp|#38);/giu, '&')
    .replace(/&(?:lt|#60);/giu, '<')
    .replace(/&(?:gt|#62);/giu, '>')
    .replace(/&(?:quot|#34);/giu, '"')
    .replace(/&#(?:39|x27);/giu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function isAuxiliaryRecordTitle(value) {
  return /^(?:fig(?:ure)?|table|appendix|supplement(?:ary)?(?:\s+(?:figure|table|material))?)\s*[\d.:_-]/iu
    .test(value)
    || /^re\s*:/iu.test(value);
}

function normalizeSearchWork(work) {
  const dateParts = work?.published?.['date-parts']
    ?? work?.issued?.['date-parts'];
  const publishedYear = Number(dateParts?.[0]?.[0]) || null;
  const doi = String(work?.DOI ?? '').toLocaleLowerCase('en');
  return {
    doi: doi || null,
    title: firstText(work?.title) || 'Untitled publication',
    authors: Array.isArray(work?.author)
      ? work.author.map((item) => [item.given, item.family].filter(Boolean).join(' ')).filter(Boolean)
      : [],
    publishedYear,
    publisher: firstText(work?.publisher) || null,
    containerTitle: firstText(work?.['container-title']) || null,
    workType: firstText(work?.type) || null,
    doiUrl: doi ? `https://doi.org/${doi}` : null,
  };
}

function tokens(value) {
  return new Set(String(value ?? '').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? []);
}

function overlapScore(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / Math.max(a.size, b.size);
}

export async function searchLiteratureQuery({
  query,
  author = '',
  year = '',
}, {
  fetchImpl = globalThis.fetch,
  contactEmail = process.env.CROSSREF_CONTACT_EMAIL,
} = {}) {
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query.bibliographic', String(query).slice(0, 500));
  url.searchParams.set('rows', String(MAX_PROVIDER_RESULTS));
  if (author) url.searchParams.set('query.author', String(author).slice(0, 120));
  if (year) url.searchParams.set('filter', `from-pub-date:${year},until-pub-date:${year}`);
  if (contactEmail) url.searchParams.set('mailto', contactEmail);
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': `ThesisRewriter/0.1${contactEmail ? ` (mailto:${contactEmail})` : ''}`,
    },
    signal: AbortSignal.timeout(7_500),
  });
  if (!response.ok) {
    const error = new Error('Publication search is temporarily unavailable.');
    error.statusCode = response.status;
    throw error;
  }
  const works = (await response.json())?.message?.items;
  if (!Array.isArray(works)) throw new Error('Publication search returned an invalid response.');
  return {
    items: works.map((work) => {
      const normalized = normalizeSearchWork(work);
      const reasons = [];
      const titleOverlap = overlapScore(query, normalized.title);
      const authorMatch = author && normalized.authors.some((name) => (
        name.toLocaleLowerCase('en').includes(String(author).toLocaleLowerCase('en'))
      ));
      const yearMatch = year && String(normalized.publishedYear) === String(year);
      if (yearMatch) reasons.push('exact-year');
      if (authorMatch) reasons.push('author-family-match');
      if (titleOverlap >= 0.7) reasons.push('high-title-overlap');
      else if (titleOverlap >= 0.35) reasons.push('partial-title-overlap');
      return {
        ...normalized,
        year: normalized.publishedYear ? String(normalized.publishedYear) : null,
        providerScore: Number(work.score) || 0,
        localConfidence: Number(Math.min(
          0.99,
          (titleOverlap * 0.65) + (authorMatch ? 0.2 : 0) + (yearMatch ? 0.15 : 0),
        ).toFixed(3)),
        confidenceReasons: reasons,
      };
    })
      .filter((item) => !isAuxiliaryRecordTitle(item.title))
      .sort((left, right) => (
        right.localConfidence - left.localConfidence
        || right.providerScore - left.providerScore
      ))
      .slice(0, MAX_RESULTS),
  };
}
