const DOI_PATTERN = /10\.\d{4,9}\/[\-._;()/:a-z0-9]+/iu;
const YEAR_PATTERN = /\b(?:19|20)\d{2}[a-z]?\b/iu;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/iu;

function plainText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(?:amp|#38);/giu, '&')
    .replace(/&(?:lt|#60);/giu, '<')
    .replace(/&(?:gt|#62);/giu, '>')
    .replace(/&(?:quot|#34);/giu, '"')
    .replace(/&#(?:39|x27);/giu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function authorMetadata(authorText) {
  const authorRecords = [...authorText.matchAll(
    /(?:^|[;,]\s*|&\s*)([\p{Lu}][\p{L}'’-]+),\s*((?:(?:[\p{Lu}]\.\s*)+|[\p{Lu}][\p{L}'’-]+))/gu,
  )].map((match) => ({
    familyName: match[1],
    givenText: match[2].trim(),
    firstInitial: match[2].match(/\p{L}/u)?.[0]?.toLocaleLowerCase('en') ?? null,
  }));
  if (authorRecords.length) {
    const familyNames = authorRecords.map((record) => record.familyName);
    return {
      authors: [...new Set(familyNames)].slice(0, 12),
      authorFamilyNames: [...new Set(familyNames.map((name) => name.toLocaleLowerCase('en')))],
      authorInitials: authorRecords.map((record) => record.firstInitial),
      organizationAuthor: null,
    };
  }
  const organization = authorText
    .replace(/[.(),\s]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!organization) {
    return {
      authors: [],
      authorFamilyNames: [],
      authorInitials: [],
      organizationAuthor: null,
    };
  }
  const key = organization.match(/[\p{L}'’-]+$/u)?.[0]?.toLocaleLowerCase('en') ?? '';
  const isOrganization = /\b(?:academy|agency|association|bank|center|centre|committee|company|corporation|department|foundation|government|health|institute|medicine|ministry|office|organization|society|university)\b/iu
    .test(organization);
  return {
    authors: [organization],
    authorFamilyNames: key ? [key] : [],
    authorInitials: [],
    organizationAuthor: isOrganization ? organization : null,
  };
}

function referenceTitle(raw, yearMatch, doi) {
  const quoted = raw.match(/["“]([^"”]+)["”]/u);
  if (quoted?.[1]) return plainText(quoted[1]).replace(/[.]+$/u, '');
  if (!yearMatch) return null;
  const afterYear = raw
    .slice(yearMatch.index + yearMatch[0].length)
    .replace(/^[a-z]?\)?[.,]?\s*/iu, '');
  const pieces = afterYear
    .split(/\.\s+(?=[\p{Lu}\d"'])/u)
    .map(plainText)
    .filter(Boolean);
  return pieces.find((piece) => (
    piece.length > 12
    && !piece.includes(doi ?? '\u0000')
    && !/^(?:https?:\/\/|www\.)/iu.test(piece)
  )) ?? null;
}

function referenceParts(raw, yearMatch, title, doi) {
  const quoted = raw.match(/["“]([^"”]+)["”]/u);
  let authorText = '';
  let sourceText = '';
  if (quoted?.[1]) {
    authorText = raw.slice(0, quoted.index).trim();
    sourceText = raw.slice((quoted.index ?? 0) + quoted[0].length);
  } else if (yearMatch) {
    authorText = raw.slice(0, yearMatch.index).replace(/\s*\(\s*$/u, '').trim();
    const afterYear = raw
      .slice(yearMatch.index + yearMatch[0].length)
      .replace(/^[a-z]?\)?[.,]?\s*/iu, '');
    const titleIndex = title ? afterYear.indexOf(title) : -1;
    sourceText = titleIndex >= 0
      ? afterYear.slice(titleIndex + title.length)
      : afterYear;
  } else {
    authorText = raw.split('.')[0];
  }
  const escapedDoi = doi?.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') ?? null;
  sourceText = plainText(sourceText)
    .replace(new RegExp(`\\b${YEAR_PATTERN.source}\\b[.,]?`, 'iu'), ' ')
    .replace(URL_PATTERN, ' ')
    .replace(escapedDoi ? new RegExp(escapedDoi, 'iu') : /\u0000/u, ' ')
    .replace(/^[\s,.;:()]+|[\s,.;:()]+$/gu, '')
    .replace(/\s+/gu, ' ');
  return {
    authorText: plainText(authorText),
    sourceText,
    url: raw.match(URL_PATTERN)?.[0]?.replace(/[.,;:]+$/u, '') ?? null,
  };
}

export function parseReferenceString({ rawReferenceText }) {
  const raw = plainText(rawReferenceText);
  const doi = raw.match(DOI_PATTERN)?.[0]
    ?.replace(/[.,;:]+$/u, '')
    .toLocaleLowerCase('en') ?? null;
  const yearMatch = raw.match(YEAR_PATTERN);
  const year = yearMatch?.[0] ?? null;
  const title = referenceTitle(raw, yearMatch, doi);
  const parts = referenceParts(raw, yearMatch, title, doi);
  const {
    authors,
    authorFamilyNames,
    authorInitials,
    organizationAuthor,
  } = authorMetadata(parts.authorText);
  const present = [Boolean(title), Boolean(authors.length), Boolean(year), Boolean(doi)];
  const confidence = Number((present.filter(Boolean).length / present.length).toFixed(2));
  const warnings = [];
  if (!title) warnings.push('title-not-detected');
  if (!authors.length) warnings.push('authors-not-detected');
  if (!year) warnings.push('year-not-detected');
  if (!doi) warnings.push('doi-not-detected');
  return {
    metadata: {
      title,
      authors,
      authorFamilyNames,
      authorInitials,
      organizationAuthor,
      authorText: parts.authorText,
      year,
      doi,
      url: parts.url,
      sourceText: parts.sourceText,
    },
    confidence,
    warnings,
  };
}
