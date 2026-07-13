import { useEffect, useMemo, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal.jsx';
import DocumentCard from '../components/DocumentCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { useRealtime } from '../components/RealtimeProvider.jsx';
import { getVersion, revertVersion } from '../services/versionsApi.js';

const MAX_DIFF_TOKENS = 1200;

function textFromTiptap(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';

  const childText = Array.isArray(node.content)
    ? node.content.map(textFromTiptap).join('')
    : '';

  if (['paragraph', 'heading'].includes(node.type)) {
    return `${childText}\n`;
  }
  return childText;
}

function textFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => block.text_content ?? block.textContent ?? '')
    .filter(Boolean)
    .join('\n');
}

function currentDocumentText(document) {
  return textFromBlocks(document?.blocks) || textFromTiptap(document?.content_json) || '';
}

function snapshotText(version) {
  const snapshot = version?.snapshot_json ?? {};
  return textFromBlocks(snapshot.blocks) || textFromTiptap(snapshot.document?.content_json) || '';
}

function tokenize(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(\s+)/)
    .filter(Boolean);
}

function pushSegment(segments, type, value) {
  if (!value) return;
  const previous = segments[segments.length - 1];
  if (previous?.type === type) {
    previous.text += value;
    return;
  }
  segments.push({ type, text: value });
}

function diffText(previousText, nextText) {
  const previous = tokenize(previousText);
  const next = tokenize(nextText);

  if (!previous.length && !next.length) return [];
  if (previous.length + next.length > MAX_DIFF_TOKENS) {
    return [
      { type: 'removed', text: previous.join(' ') },
      { type: 'added', text: next.join(' ') },
    ];
  }

  const table = Array.from({ length: previous.length + 1 }, () => (
    Array(next.length + 1).fill(0)
  ));

  for (let i = previous.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      table[i][j] = previous[i] === next[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const segments = [];
  let i = 0;
  let j = 0;

  while (i < previous.length && j < next.length) {
    if (previous[i] === next[j]) {
      pushSegment(segments, 'same', next[j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      pushSegment(segments, 'removed', previous[i]);
      i += 1;
    } else {
      pushSegment(segments, 'added', next[j]);
      j += 1;
    }
  }

  while (i < previous.length) {
    pushSegment(segments, 'removed', previous[i]);
    i += 1;
  }
  while (j < next.length) {
    pushSegment(segments, 'added', next[j]);
    j += 1;
  }

  return segments;
}

export default function HomepageVersionControl({
  documents = [],
  onNotice,
  onDocumentReverted,
}) {
  const {
    state: realtimeState,
    applyDocument,
    applyVersion,
    refreshDocument,
    refreshVersions,
  } = useRealtime();
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [pendingRevert, setPendingRevert] = useState(null);
  const [documentDetail, setDocumentDetail] = useState(null);
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) ?? null;
  const versions = realtimeState.versionsByDocument[selectedDocumentId] ?? [];
  const activeDocument = documentDetail ?? selectedDocument;
  const diffSegments = useMemo(() => {
    if (!selectedVersion) return [];
    return diffText(snapshotText(selectedVersion), currentDocumentText(activeDocument));
  }, [activeDocument, selectedVersion]);

  useEffect(() => {
    if (!documents.length) {
      setSelectedDocumentId(null);
      setDocumentDetail(null);
      setSelectedVersion(null);
      return undefined;
    }

    if (selectedDocumentId && !documents.some((document) => document.id === selectedDocumentId)) {
      setSelectedDocumentId(null);
    }
    return undefined;
  }, [documents, selectedDocumentId]);

  useEffect(() => {
    if (!selectedDocument?.id) {
      setDocumentDetail(null);
      setSelectedVersion(null);
      return undefined;
    }

    let alive = true;
    setSelectedVersion(null);
    Promise.all([
      refreshVersions(selectedDocument.id),
      refreshDocument(selectedDocument.id),
    ])
      .then(([_versions, currentDocument]) => {
        if (!alive) return;
        setDocumentDetail(currentDocument ?? selectedDocument);
      })
      .catch((error) => {
        if (!alive) return;
        setDocumentDetail(selectedDocument);
        onNotice?.(error.message || 'Could not load version history.');
      });

    return () => {
      alive = false;
    };
  }, [onNotice, refreshDocument, refreshVersions, selectedDocument?.id]);

  useEffect(() => {
    const realtimeDocument = realtimeState.documentDetails[selectedDocumentId];
    if (realtimeDocument) setDocumentDetail(realtimeDocument);
  }, [realtimeState.documentDetails, selectedDocumentId]);

  async function handleView(version) {
    if (!selectedDocument) return;
    try {
      if (selectedVersion?.id === version.id) {
        setSelectedVersion(null);
        return;
      }
      const data = await getVersion(selectedDocument.id, version.id);
      setSelectedVersion({ ...version, ...data.version });
    } catch (error) {
      onNotice?.(error.message || 'Could not load version detail.');
    }
  }

  async function handleRevert() {
    if (!pendingRevert || !selectedDocument) return;

    try {
      const data = await revertVersion(selectedDocument.id, pendingRevert.id);
      setPendingRevert(null);
      setSelectedVersion(null);
      setDocumentDetail(data.document ?? selectedDocument);
      applyDocument('document:reverted', data.document);
      if (data.version) applyVersion(selectedDocument.id, data.version);
      onDocumentReverted?.(data.document);
      onNotice?.('Document reverted and new version appended.');
    } catch (error) {
      onNotice?.(error.message || 'Revert failed.');
    }
  }

  if (!documents.length) {
    return <EmptyState title="Version History">Create or upload a document to start tracking versions.</EmptyState>;
  }

  function handleBackToDocuments() {
    setSelectedDocumentId(null);
    setDocumentDetail(null);
    setSelectedVersion(null);
    setPendingRevert(null);
  }

  return (
    <section className="home-subpage">
      <header className="home-subpage-header">
        <div>
          <h1>Version History</h1>
          <p>Select a document to inspect its saved versions.</p>
        </div>
      </header>

      {!selectedDocument ? (
        <section className="version-document-picker" aria-label="Documents with version history">
          <div className="documents-heading">
            <h2>Your documents</h2>
            <p>{documents.length} documents</p>
          </div>
          <div className="documents-grid">
            {documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                onOpen={() => setSelectedDocumentId(document.id)}
                showMenu={false}
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="version-document-history" aria-live="polite">
          <div className="version-document-heading">
            <div>
              <button type="button" className="version-back-button" onClick={handleBackToDocuments}>
                Back to documents
              </button>
              <h2>{activeDocument?.title ?? selectedDocument.title}</h2>
            </div>
            <p>{versions.length} saved versions</p>
          </div>

          {!versions.length ? (
            <EmptyState title="No saved versions yet">Saving this document will append versions here.</EmptyState>
          ) : (
            <div className="version-list">
              {versions.map((version) => (
                <div className="version-entry" key={version.id}>
                  <article className={`version-item${selectedVersion?.id === version.id ? ' is-selected' : ''}`}>
                    <div>
                      <strong>Version {version.version_number}</strong>
                      <p>{version.text_preview}</p>
                      <time>{new Date(version.created_at).toLocaleString()}</time>
                    </div>
                    <div className="version-actions">
                      <button
                        type="button"
                        onClick={() => handleView(version)}
                        aria-expanded={selectedVersion?.id === version.id}
                      >
                        {selectedVersion?.id === version.id ? 'Hide Difference' : 'View Difference'}
                      </button>
                      <button type="button" className="danger" onClick={() => setPendingRevert(version)}>Revert</button>
                    </div>
                  </article>

                  {selectedVersion?.id === version.id ? (
                    <section className="version-diff" aria-label={`Current version compared with Version ${version.version_number}`}>
                      <article>
                        <h2>Current Version</h2>
                        <div className="version-diff-summary" aria-hidden="true">
                          <span className="diff-added">Added in current</span>
                          <span className="diff-removed">Removed from version</span>
                        </div>
                        <div className="version-diff-text">
                          {diffSegments.map((segment, index) => {
                            if (segment.type === 'added') {
                              return <ins key={`${segment.type}-${index}`}>{segment.text}</ins>;
                            }
                            if (segment.type === 'removed') {
                              return <del key={`${segment.type}-${index}`}>{segment.text}</del>;
                            }
                            return <span key={`${segment.type}-${index}`}>{segment.text}</span>;
                          })}
                        </div>
                      </article>
                      <article>
                        <h2>Version {version.version_number}</h2>
                        <pre>{snapshotText(selectedVersion) || 'No text snapshot is available for this version.'}</pre>
                      </article>
                    </section>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {pendingRevert ? (
        <ConfirmModal
          title={`Revert to Version ${pendingRevert.version_number}?`}
          confirmLabel="Revert"
          onCancel={() => setPendingRevert(null)}
          onConfirm={handleRevert}
        >
          Current uncommitted progress will be overwritten by the selected snapshot.
        </ConfirmModal>
      ) : null}
    </section>
  );
}
