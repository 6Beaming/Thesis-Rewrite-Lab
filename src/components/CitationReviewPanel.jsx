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

function citationItemKey(item, type) {
  const anchor = item?.anchor;
  return [
    type,
    anchor?.blockId ?? item?.blockId ?? 'unknown',
    anchor?.citationStartCp ?? '',
    anchor?.citationEndCp ?? '',
  ].join(':');
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export default function CitationReviewPanel({
  document,
  disabled = false,
  onBeforeCheck,
  onDocumentApplied,
  onNavigateToCitation,
}) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState(null);
  const [candidateSelection, setCandidateSelection] = useState(null);
  const [dismissedItemKeys, setDismissedItemKeys] = useState(() => new Set());
  const citationReviewDisabled = disabled || document?.academic_style === 'Customized';

  useEffect(() => {
    setResult(null);
    setError('');
    setProposal(null);
    setCandidateSelection(null);
    setDismissedItemKeys(new Set());
  }, [document?.id, document?.academic_style]);

  async function runCheck() {
    if (!document?.id || busy || citationReviewDisabled) return;
    setBusy(true);
    setError('');
    setProposal(null);
    setCandidateSelection(null);
    try {
      const ready = await onBeforeCheck?.();
      if (ready === false) return;
      const response = await checkDocumentCitations(document.id);
      setResult(response.result);
      setDismissedItemKeys(new Set());
    } catch (cause) {
      setError(cause.message || 'Citation review is unavailable.');
    } finally {
      setBusy(false);
    }
  }

  function navigateToCitation(anchor) {
    onNavigateToCitation?.(anchor);
  }

  function dismissCitationItem(itemKey) {
    setDismissedItemKeys((current) => {
      const next = new Set(current);
      next.add(itemKey);
      return next;
    });
    setProposal((current) => (current?.itemKey === itemKey ? null : current));
    setCandidateSelection((current) => (current?.itemKey === itemKey ? null : current));
  }

  function renderItemDismissButton(itemKey, label) {
    return (
      <button
        className="citation-review-item__dismiss"
        type="button"
        onClick={() => dismissCitationItem(itemKey)}
        aria-label={label}
        title="Dismiss"
      >
        <CloseIcon />
      </button>
    );
  }

  async function proposeFromMetadata(item, metadata, itemKey) {
    const bibliographyCompletion = result?.workflow === 'bibliography-completion';
    const rendered = await renderDocumentCitation(document.id, {
      metadata,
      styleName: document.academic_style === 'MLA' ? 'MLA9'
        : document.academic_style === 'Chicago' ? 'Chicago' : 'APA7',
      mode: bibliographyCompletion ? 'bibliography' : 'inline',
    });
    setProposal({
      itemKey,
      navigationAnchor: item.anchor,
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

  async function findReplacement(item, itemKey) {
    if (item.replaceable === false) {
      setError('This grouped citation contains several sources. Review each source in the group before replacing it.');
      return;
    }
    setBusy(true);
    setError('');
    setProposal(null);
    setCandidateSelection(null);
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
        setCandidateSelection({ item, itemKey, items: listedCandidates });
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
        setCandidateSelection({ item, itemKey, items: searched.items });
        return;
      }
      await proposeFromMetadata(item, top, itemKey);
    } catch (cause) {
      setError(cause.message || 'No safe citation replacement could be proposed.');
    } finally {
      setBusy(false);
    }
  }

  function proposeFormattingChange(item, itemKey) {
    setCandidateSelection(null);
    setProposal({
      itemKey,
      navigationAnchor: item.anchor,
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
      onDocumentApplied?.(response.document, {
        anchor: proposal.anchor,
        replacementText: proposal.replacementText,
      });
    } catch (cause) {
      setError(cause.message || 'The citation location changed, so the replacement was not applied.');
    } finally {
      setBusy(false);
    }
  }

  function renderProposal(itemKey) {
    if (!proposal || proposal.itemKey !== itemKey) return null;
    return (
      <article className="citation-patch-proposal">
        <strong>Suggested citation change</strong>
        <p><del>{proposal.originalText}</del> → <ins>{proposal.replacementText}</ins></p>
        {proposal.metadata?.title ? <small>{proposal.metadata.title}</small> : null}
        <div>
          <button
            className="citation-review-button citation-review-button--secondary"
            type="button"
            onClick={() => {
              navigateToCitation(proposal.navigationAnchor ?? proposal.anchor);
              setProposal(null);
            }}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="citation-review-button citation-review-button--primary"
            type="button"
            onClick={() => {
              navigateToCitation(proposal.navigationAnchor ?? proposal.anchor);
              void acceptProposal();
            }}
            disabled={busy}
          >
            Accept change
          </button>
        </div>
      </article>
    );
  }

  function renderCandidateSelection(itemKey) {
    if (!candidateSelection || candidateSelection.itemKey !== itemKey) return null;
    return (
      <section className="citation-candidate-selection">
        <div className="citation-candidate-selection__heading">
          <strong>Select the matching source</strong>
          <button
            className="citation-candidate-selection__close"
            type="button"
            onClick={() => setCandidateSelection(null)}
            aria-label="Cancel source selection"
            title="Cancel"
          >
            <CloseIcon />
          </button>
        </div>
        <p>Select the possible publication you used.</p>
        {candidateSelection.items.map((candidate) => (
          <button
            className="citation-candidate"
            key={candidate.doi ?? candidate.title}
            type="button"
            disabled={busy}
            onClick={async () => {
              navigateToCitation(candidateSelection.item.anchor);
              setBusy(true);
              try {
                await proposeFromMetadata(
                  candidateSelection.item,
                  candidate,
                  candidateSelection.itemKey,
                );
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
      </section>
    );
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
          {(result.formattingIssues ?? []).map((item) => {
            const itemKey = citationItemKey(item, 'format');
            if (dismissedItemKeys.has(itemKey)) return null;
            return (
              <div className="citation-review-item-group" key={itemKey}>
                <article className="citation-review-item citation-review-item--format">
                  <strong>{citationStyleLabel(item.styleName)} citation format needs an update</strong>
                  {renderItemDismissButton(itemKey, 'Dismiss citation format issue')}
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
                    onClick={() => {
                      navigateToCitation(item.anchor);
                      proposeFormattingChange(item, itemKey);
                    }}
                    disabled={busy}
                  >
                    Review format change
                  </button>
                  {renderProposal(itemKey)}
                </article>
              </div>
            );
          })}
          {result.unresolved.map((item) => {
            const itemKey = citationItemKey(item, 'unresolved');
            if (dismissedItemKeys.has(itemKey)) return null;
            return (
              <div className="citation-review-item-group" key={itemKey}>
                <article className="citation-review-item citation-review-item--unresolved">
                  <strong>Citation needs a matching source</strong>
                  {renderItemDismissButton(itemKey, 'Dismiss citation issue')}
                  <q>{item.displayText ?? item.text}</q>
                  <button
                    className="citation-review-button"
                    type="button"
                    onClick={() => {
                      navigateToCitation(item.anchor);
                      void findReplacement(item, itemKey);
                    }}
                    disabled={busy}
                  >
                    Find the source
                  </button>
                  {renderCandidateSelection(itemKey)}
                  {renderProposal(itemKey)}
                </article>
              </div>
            );
          })}
          {result.orphaned.map((item) => {
            const itemKey = citationItemKey(item, 'orphaned');
            if (dismissedItemKeys.has(itemKey)) return null;
            return (
              <article className="citation-review-item citation-review-item--orphaned" key={itemKey}>
                <strong>{item.parsed?.metadata?.title ?? 'Listed source not found in the text'}</strong>
                {renderItemDismissButton(itemKey, 'Dismiss listed source issue')}
                <span>{sourceDetails(item.parsed?.metadata)}</span>
                {(result.recommendations?.find((entry) => entry.blockId === item.blockId)
                  ?.candidates ?? []).map((candidate) => (
                    <small key={candidate.blockId}>
                      Possible related passage: {candidate.evidence}
                    </small>
                  ))}
              </article>
            );
          })}
          {!result.unresolved.length
            && !result.orphaned.length
            && !(result.formattingIssues ?? []).length ? (
              <p>Every citation matches a listed source and the selected citation style.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
