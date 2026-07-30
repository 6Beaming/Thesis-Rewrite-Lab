import { useEffect, useMemo, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal.jsx';
import DocumentCard from '../components/DocumentCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { useRealtime } from '../components/RealtimeProvider.jsx';
import { getVersion, revertVersion } from '../services/versionsApi.js';
import { diffLogicalBlocks, historicalDocumentVersions } from '../lib/versionDiff.js';
import versionHistoryUrl from '../assets/version_history.png?url';

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

function logicalBlocks(source, snapshot = false) {
  const root = snapshot ? source?.snapshot_json ?? {} : source ?? {};
  const blocks = snapshot ? root.blocks : root.blocks;
  if (Array.isArray(blocks) && blocks.length) {
    return blocks.map((block, index) => ({
      id: block.id ?? block.block_id ?? `legacy-${index}`,
      text: block.text_content ?? block.text ?? '',
    }));
  }
  return [{ id: 'legacy-document', text: snapshot ? snapshotText(source) : currentDocumentText(source) }];
}

function DiffView({ segments, side }) {
  return (
    <div className="version-diff-text">
      {segments.map((segment, index) => {
        if (side === 'new' && segment.type === 'added') {
          return <ins key={`${segment.type}-${index}`}>{segment.text}</ins>;
        }
        if (side === 'old' && segment.type === 'removed') {
          return <del key={`${segment.type}-${index}`}>{segment.text}</del>;
        }
        return <span key={`${segment.type}-${index}`}>{segment.text}</span>;
      })}
    </div>
  );
}

export default function HomepageVersionControl({
  documents = [],
  onError,
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
  const historicalVersions = useMemo(() => historicalDocumentVersions(versions), [versions]);
  const activeDocument = documentDetail ?? selectedDocument;
  const diffViews = useMemo(() => {
    if (!selectedVersion) return { oldView: [], newView: [] };
    return diffLogicalBlocks(
      logicalBlocks(selectedVersion, true),
      logicalBlocks(activeDocument),
    );
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
    onError?.('');
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
        onError?.(error.message || 'Could not load version history.');
      });

    return () => {
      alive = false;
    };
  }, [onError, refreshDocument, refreshVersions, selectedDocument?.id]);

  useEffect(() => {
    const realtimeDocument = realtimeState.documentDetails[selectedDocumentId];
    if (realtimeDocument) setDocumentDetail(realtimeDocument);
  }, [realtimeState.documentDetails, selectedDocumentId]);

  async function handleView(version) {
    if (!selectedDocument) return;
    onError?.('');
    try {
      if (selectedVersion?.id === version.id) {
        setSelectedVersion(null);
        return;
      }
      const data = await getVersion(selectedDocument.id, version.id);
      setSelectedVersion({ ...version, ...data.version });
    } catch (error) {
      onError?.(error.message || 'Could not load version detail.');
    }
  }

  async function handleRevert() {
    if (!pendingRevert || !selectedDocument) return;

    onError?.('');
    try {
      const data = await revertVersion(selectedDocument.id, pendingRevert.id);
      setPendingRevert(null);
      setSelectedVersion(null);
      setDocumentDetail(data.document ?? selectedDocument);
      applyDocument('document:reverted', data.document);
      if (data.version) applyVersion(selectedDocument.id, data.version);
      onDocumentReverted?.(data.document);
    } catch (error) {
      onError?.(error.message || 'Revert failed.');
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
      <header className="home-subpage-header home-subpage-header--illustrated">
        <div className="home-subpage-header-copy">
          <h1><strong>Version history</strong></h1>
          <p>Select a document to inspect its saved versions.</p>
        </div>
        <img className="home-subpage-header-art" src={versionHistoryUrl} alt="" />
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
            <p>
              {historicalVersions.length}
              {' '}
              earlier
              {' '}
              {historicalVersions.length === 1 ? 'version' : 'versions'}
            </p>
          </div>

          {!historicalVersions.length ? (
            <EmptyState title="No earlier versions yet">
              Make and save a content change to create a version you can compare with the current document.
            </EmptyState>
          ) : (
            <div className="version-list">
              {historicalVersions.map((version) => (
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
                        <DiffView segments={diffViews.newView} side="new" />
                      </article>
                      <article>
                        <h2>Version {version.version_number}</h2>
                        <DiffView segments={diffViews.oldView} side="old" />
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
