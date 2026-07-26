export const CITATION_RENDERER_VERSION = 'citation-renderer-v2';

function familyName(name) {
  const parts = String(name ?? '').trim().split(/\s+/u);
  return (parts.at(-1) ?? '').replace(/[^\p{L}'-]+$/gu, '');
}

function authorLabel(authors = [], organizationAuthor = null) {
  if (organizationAuthor) return organizationAuthor;
  const families = authors.map(familyName).filter(Boolean);
  if (!families.length) return null;
  if (families.length === 1) return families[0];
  if (families.length === 2) return `${families[0]} & ${families[1]}`;
  return `${families[0]} et al.`;
}

function sentence(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function quotedTitle(title) {
  return `"${String(title ?? '').replace(/[.]+$/u, '')}."`;
}

export function renderCitationStyle({ metadata = {}, styleName = 'APA7', mode = 'inline' }) {
  const style = ['APA7', 'MLA9', 'Chicago'].includes(styleName) ? styleName : 'APA7';
  const authors = Array.isArray(metadata.authors) ? metadata.authors.filter(Boolean) : [];
  const author = authorLabel(authors, metadata.organizationAuthor);
  const year = metadata.year ?? metadata.publishedYear ?? null;
  const title = String(metadata.title ?? '').trim();
  const container = String(metadata.containerTitle ?? metadata.publisher ?? '').trim();
  const source = String(metadata.sourceText ?? container).trim();
  const authorText = String(
    metadata.authorText
      ?? metadata.organizationAuthor
      ?? authors.join(', ')
      ?? '',
  ).trim();
  const doi = String(metadata.doi ?? '').trim().toLocaleLowerCase('en');
  const url = String(metadata.url ?? '').trim();
  const locator = doi ? `https://doi.org/${doi}` : url;
  let text = '';
  if (mode === 'inline') {
    if (!author) throw new Error('Citation rendering requires author metadata.');
    text = style === 'MLA9'
      ? `(${author})`
      : `(${author}${year ? `, ${year}` : ', n.d.'})`;
  } else {
    if (!title) throw new Error('Bibliography rendering requires a title.');
    const renderedAuthor = sentence(authorText || 'Unknown author');
    const renderedSource = source ? sentence(source) : '';
    if (style === 'MLA9') {
      text = `${renderedAuthor} ${quotedTitle(title)}${renderedSource ? ` ${renderedSource}` : ''}${year ? ` ${year}.` : ''}${locator ? ` ${sentence(locator)}` : ''}`;
    } else if (style === 'Chicago') {
      text = `${renderedAuthor} ${quotedTitle(title)}${renderedSource ? ` ${renderedSource}` : ''}${year ? ` ${year}.` : ''}${locator ? ` ${sentence(locator)}` : ''}`;
    } else {
      text = `${renderedAuthor} (${year || 'n.d.'}). ${sentence(title)}${renderedSource ? ` ${renderedSource}` : ''}${locator ? ` ${locator}` : ''}`;
    }
  }
  return {
    text: text.replace(/\s+/gu, ' ').trim(),
    styleName: style,
    mode,
    rendererVersion: CITATION_RENDERER_VERSION,
  };
}
