import { useEffect, useState } from 'react';
import {
  applyDocumentCitationPatch,
  checkDocumentCitations,
  renderDocumentCitation,
  searchDocumentCitations,
} from '../services/citationsApi.js';

function readableAuthors(authors = []) {
  const visible = authors.filter(Boolean).slice(0, 3);
  if (!visible.length) return 'Author not listed';
  return `${visible.join(', ')}${authors.length > visible.length ? ', et al.' : ''}`;
}

function sourceDetails(metadata = {}) {
  return [
    readableAuthors(metadata.authors),
    metadata.year ?? metadata.publishedYear ?? 'Year not listed',
    metadata.containerTitle ?? metadata.publisher,
  ].filter(Boolean).join(' · ');
}

function citationStyleLabel(styleName) {
  if (styleName === 'MLA9') return 'MLA';
  if (styleName === 'Chicago') return 'Chicago';
  return 'APA';
}

export default function CitationReviewPanel({
  document,
  disabled = false,
  onDocumentApplied,
}) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState(null);
  const [candidateSelection, setCandidateSelection] = useState(null);
  const citationReviewDisabled = disabled || document?.academic_style === 'Customized';

  useEffect(() => {
    setResult(null);
    setError('');
    setProposal(null);
    setCandidateSelection(null);
  }, [document?.id, document?.revision, document?.academic_style]);

  async function runCheck() {
    if (!document?.id || busy || citationReviewDisabled) return;
    setBusy(true);
    setError('');
    setProposal(null);
    setCandidateSelection(null);
    try {
      const response = await checkDocumentCitations(document.id);
      setResult(response.result);
    } catch (cause) {
      setError(cause.message || 'Citation review is unavailable.');
    } finally {
      setBusy(false);
    }
  }

  async function proposeFromMetadata(item, metadata) {
    const bibliographyCompletion = result?.workflow === 'bibliography-completion';
    const rendered = await renderDocumentCitation(document.id, {
      metadata,
      styleName: document.academic_style === 'MLA' ? 'MLA9'
        : document.academic_style === 'Chicago' ? 'Chicago' : 'APA7',
      mode: bibliographyCompletion ? 'bibliography' : 'inline',
    });
    setProposal({
      anchor: bibliographyCompletion ? result.appendAnchor : item.anchor,
      originalText: bibliographyCompletion ? '' : item.text,
      replacementText: bibliographyCompletion
        ? `\n\nReferences\n${rendered.citation.text}`
        : rendered.citation.text,
      metadata,
      rendererVersion: rendered.citation.rendererVersion,
    });
    setCandidateSelection(null);
  }

  async function findReplacement(item) {
    if (item.replaceable === false) {
      setError('This grouped citation contains several sources. Review each source in the group before replacing it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const listedCandidates = (result?.orphaned ?? [])
        .filter((entry) => (
          entry.parsed?.metadata?.title
          && String(entry.parsed.metadata.year ?? '') === String(item.year ?? '').slice(0, 4)
        ))
        .map((entry) => ({
          ...entry.parsed.metadata,
          localConfidence: 1,
          listedInDocument: true,
        }));
      if (listedCandidates.length) {
        setCandidateSelection({ item, items: listedCandidates });
        return;
      }
      const searched = await searchDocumentCitations(document.id, {
        query: item.displayText ?? item.text.replace(/[()]/gu, ''),
        author: item.authorKey ?? '',
        year: item.year?.slice(0, 4) ?? '',
      });
      if (!searched.items?.length) throw new Error('No matching article or book was found.');
      const top = searched.items[0];
      if (
        searched.items[1]
        && Math.abs(top.localConfidence - searched.items[1].localConfidence) < 0.1
      ) {
        setCandidateSelection({ item, items: searched.items });
        return;
      }
      await proposeFromMetadata(item, top);
    } catch (cause) {
      setError(cause.message || 'No safe citation replacement could be proposed.');
    } finally {
      setBusy(false);
    }
  }

  function proposeFormattingChange(item) {
    setProposal({
      anchor: item.anchor,
      originalText: item.originalText,
      replacementText: item.replacementText,
      metadata: item.metadata,
      rendererVersion: result?.workflowVersion,
    });
  }

  async function acceptProposal() {
    if (!proposal || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await applyDocumentCitationPatch(document.id, {
        anchor: proposal.anchor,
        replacementText: proposal.replacementText,
        expectedRevision: Number(document.revision),
        expectedPartitionRevision: Number(document.partition_revision),
      });
      setProposal(null);
      setResult(null);
      onDocumentApplied?.(response.document);
    } catch (cause) {
      setError(cause.message || 'The citation location changed, so the replacement was not applied.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`citation-review-panel${citationReviewDisabled ? ' is-disabled' : ''}`} aria-labelledby="citation-review-heading">
      <header className="citation-review-panel__heading">
        <div>
          <h3 id="citation-review-heading">Citation review</h3>
          <p>Compare citations in your writing with the sources listed at the end. Nothing changes without your approval.</p>
        </div>
        <button className="citation-review-button citation-review-button--primary" type="button" onClick={runCheck} disabled={busy || citationReviewDisabled}>
          {citationReviewDisabled ? 'Choose a citation style' : busy ? 'Checking…' : result ? 'Check again' : 'Check citations'}
        </button>
      </header>
      {citationReviewDisabled ? (
        <p className="citation-review-disabled-note">
          Citation checking is unavailable for Customized formatting. Choose APA, MLA, or Chicago to review citations.
        </p>
      ) : null}
      {error ? <p className="analysis-error" role="alert">{error}</p> : null}
      {result ? (
        <div className="citation-review-results">
          <p>
            {result.inlineCitations.length} in-text citation{result.inlineCitations.length === 1 ? '' : 's'} ·{' '}
            {result.bibliography.length} listed source{result.bibliography.length === 1 ? '' : 's'} ·{' '}
            {(result.formattingIssues ?? []).length} format change{(result.formattingIssues ?? []).length === 1 ? '' : 's'} ·{' '}
            {result.unresolved.length} missing source{result.unresolved.length === 1 ? '' : 's'} ·{' '}
            {result.orphaned.length} unused source{result.orphaned.length === 1 ? '' : 's'}
          </p>
          {(result.formattingIssues ?? []).map((item) => (
            <article
              className="citation-review-item citation-review-item--format"
              key={`${item.anchor.blockId}-${item.anchor.citationStartCp}-format`}
            >
              <strong>{citationStyleLabel(item.styleName)} citation format needs an update</strong>
              <q>{item.originalText}</q>
              <span>Expected form: {item.replacementText}</span>
              {item.title ? <small>Matched source: {item.title}</small> : null}
              {item.reasonCodes?.includes('given-name-used-instead-of-family-name') ? (
                <small>Use the first author&apos;s family name in the in-text citation.</small>
              ) : null}
              {item.reasonCodes?.includes('secondary-source-connector') ? (
                <small>APA secondary citations use “as cited in” before the source you consulted.</small>
              ) : null}
              <button
                className="citation-review-button"
                type="button"
                onClick={() => proposeFormattingChange(item)}
                disabled={busy}
              >
                Review format change
              </button>
            </article>
          ))}
          {result.unresolved.map((item) => (
            <article
              className="citation-review-item citation-review-item--unresolved"
              key={`${item.anchor.blockId}-${item.anchor.citationStartCp}-${item.authorKey}-${item.year}`}
            >
              <strong>Citation needs a matching source</strong>
              <q>{item.displayText ?? item.text}</q>
              <button className="citation-review-button" type="button" onClick={() => findReplacement(item)} disabled={busy}>
                Find the source
              </button>
            </article>
          ))}
          {result.orphaned.map((item) => (
            <article className="citation-review-item citation-review-item--orphaned" key={item.blockId}>
              <strong>{item.parsed?.metadata?.title ?? 'Listed source not found in the text'}</strong>
              <span>{sourceDetails(item.parsed?.metadata)}</span>
              {(result.recommendations?.find((entry) => entry.blockId === item.blockId)
                ?.candidates ?? []).map((candidate) => (
                  <small key={candidate.blockId}>
                    Possible related passage: {candidate.evidence}
                  </small>
                ))}
            </article>
          ))}
          {!result.unresolved.length
            && !result.orphaned.length
            && !(result.formattingIssues ?? []).length ? (
              <p>Every citation matches a listed source and the selected citation style.</p>
          ) : null}
        </div>
      ) : null}
      {proposal ? (
        <article className="citation-patch-proposal">
          <strong>Suggested citation change</strong>
          <p><del>{proposal.originalText}</del> → <ins>{proposal.replacementText}</ins></p>
          <small>{proposal.metadata.title}</small>
          <div>
            <button className="citation-review-button citation-review-button--secondary" type="button" onClick={() => setProposal(null)} disabled={busy}>Reject</button>
            <button className="citation-review-button citation-review-button--primary" type="button" onClick={acceptProposal} disabled={busy}>Accept change</button>
          </div>
        </article>
      ) : null}
      {candidateSelection ? (
        <section className="citation-candidate-selection">
          <strong>Select the matching source</strong>
          <p>We found several possible publications. Choose the title that matches the source you used.</p>
          {candidateSelection.items.map((candidate) => (
            <button
              className="citation-candidate"
              key={candidate.doi ?? candidate.title}
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await proposeFromMetadata(candidateSelection.item, candidate);
                } catch (cause) {
                  setError(cause.message || 'The citation could not be formatted.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <strong>{candidate.title}</strong>
              <span>{sourceDetails(candidate)}</span>
              {candidate.listedInDocument ? <small>Already listed in this document</small> : null}
            </button>
          ))}
          <button className="citation-review-button citation-review-button--secondary" type="button" onClick={() => setCandidateSelection(null)}>Cancel</button>
        </section>
      ) : null}
    </section>
  );
}
