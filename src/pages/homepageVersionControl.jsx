import { useEffect, useMemo, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { getDocument } from '../services/documentsApi.js';
import { getVersion, listVersions, revertVersion } from '../services/versionsApi.js';

const MAX_DIFF_TOKENS = 1200;

function isDemoDocument(document) {
  return Boolean(document?.id?.startsWith('demo-'));
}

function paragraphNode(text) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}

function snapshotFromText(document, text) {
  return {
    document: {
      id: document.id,
      title: document.title,
      academic_style: document.academic_style,
      content_json: {
        type: 'doc',
        content: String(text)
          .split(/\n+/)
          .filter(Boolean)
          .map(paragraphNode),
      },
    },
    blocks: String(text)
      .split(/\n+/)
      .filter(Boolean)
      .map((blockText, index) => ({
        id: `${document.id}-demo-block-${index + 1}`,
        text_content: blockText,
      })),
  };
}

function demoCurrentText(document) {
  return [
    document?.snippet || document?.title || 'Demo document',
    document?.secondarySnippet || 'This local demo text lets version history work before PostgreSQL is connected.',
    `Current ${document?.academic_style || 'APA'} draft includes revised evidence, clearer transitions, and a stronger concluding sentence.`,
  ].join('\n');
}

function demoVersionText(document, variant) {
  const title = document?.title || 'Demo document';
  if (variant === 'outline') {
    return [
      `${title} started as a short outline with a broad topic sentence.`,
      'The early draft listed sources but did not connect them to the main claim.',
      'The conclusion was still a placeholder.',
    ].join('\n');
  }

  return [
    `${title} included a clearer topic sentence and one example from the reading.`,
    'The middle paragraph still needed a transition and more precise academic wording.',
    'The conclusion summarized the claim but did not explain its significance.',
  ].join('\n');
}

function buildDemoVersions(document) {
  const now = Date.now();
  return [
    {
      id: `${document.id}-demo-version-2`,
      document_id: document.id,
      version_number: 2,
      label: 'Local demo revision',
      academic_style_snapshot: document.academic_style || 'APA',
      text_preview: demoVersionText(document, 'revision').slice(0, 180),
      snapshot_json: snapshotFromText(document, demoVersionText(document, 'revision')),
      created_at: new Date(now - 45 * 60 * 1000).toISOString(),
    },
    {
      id: `${document.id}-demo-version-1`,
      document_id: document.id,
      version_number: 1,
      label: 'Local demo outline',
      academic_style_snapshot: document.academic_style || 'APA',
      text_preview: demoVersionText(document, 'outline').slice(0, 180),
      snapshot_json: snapshotFromText(document, demoVersionText(document, 'outline')),
      created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

function demoDocumentWithContent(document) {
  const text = demoCurrentText(document);
  return {
    ...document,
    content_json: snapshotFromText(document, text).document.content_json,
    blocks: snapshotFromText(document, text).blocks,
  };
}

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

export default function HomepageVersionControl({ document, onNotice, onDocumentReverted }) {
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [pendingRevert, setPendingRevert] = useState(null);
  const [documentDetail, setDocumentDetail] = useState(document);
  const activeDocument = documentDetail ?? document;
  const diffSegments = useMemo(() => {
    if (!selectedVersion) return [];
    return diffText(snapshotText(selectedVersion), currentDocumentText(activeDocument));
  }, [activeDocument, selectedVersion]);

  useEffect(() => {
    if (!document?.id) {
      setVersions([]);
      setDocumentDetail(document ?? null);
      return undefined;
    }

    if (isDemoDocument(document)) {
      setVersions(buildDemoVersions(document));
      setDocumentDetail(demoDocumentWithContent(document));
      setSelectedVersion(null);
      return undefined;
    }

    let alive = true;
    Promise.all([
      listVersions(document.id),
      getDocument(document.id),
    ])
      .then(([versionsData, documentData]) => {
        if (!alive) return;
        setVersions(versionsData.versions ?? []);
        setDocumentDetail(documentData.document ?? document);
      })
      .catch(() => {
        if (!alive) return;
        setDocumentDetail(document);
        onNotice?.('Version history needs a DB-backed document.');
      });

    return () => {
      alive = false;
    };
  }, [document?.id, onNotice]);

  async function handleView(version) {
    if (isDemoDocument(document)) {
      setSelectedVersion(version);
      return;
    }

    try {
      const data = await getVersion(document.id, version.id);
      setSelectedVersion(data.version);
    } catch (error) {
      onNotice?.(error.message || 'Could not load version detail.');
    }
  }

  async function handleRevert() {
    if (!pendingRevert) return;

    if (isDemoDocument(document)) {
      const revertedText = snapshotText(pendingRevert);
      const revertedSnapshot = snapshotFromText(document, revertedText);
      const revertedDocument = {
        ...document,
        content_json: revertedSnapshot.document.content_json,
        blocks: revertedSnapshot.blocks,
        snippet: revertedText.split('\n')[0] || document.snippet,
        secondarySnippet: revertedText.split('\n')[1] || document.secondarySnippet,
        updated_at: new Date().toISOString(),
        completed_rate: Math.min(1, Number(document.completed_rate ?? 0) + 0.04),
      };
      const nextVersion = {
        id: `${document.id}-demo-version-${Date.now()}`,
        document_id: document.id,
        version_number: Math.max(...versions.map((version) => version.version_number), 0) + 1,
        label: `Reverted to Version ${pendingRevert.version_number}`,
        academic_style_snapshot: document.academic_style || 'APA',
        text_preview: revertedText.slice(0, 180),
        snapshot_json: snapshotFromText(revertedDocument, revertedText),
        created_at: new Date().toISOString(),
      };

      setPendingRevert(null);
      setSelectedVersion(null);
      setDocumentDetail(revertedDocument);
      setVersions((current) => [nextVersion, ...current]);
      onDocumentReverted?.(revertedDocument);
      onNotice?.('Demo document reverted and local version appended.');
      return;
    }

    try {
      const data = await revertVersion(document.id, pendingRevert.id);
      setPendingRevert(null);
      setSelectedVersion(null);
      setDocumentDetail(data.document ?? document);
      if (data.version) {
        setVersions((current) => [data.version, ...current]);
      }
      onDocumentReverted?.(data.document);
      onNotice?.('Document reverted and new version appended.');
    } catch (error) {
      onNotice?.(error.message || 'Revert failed.');
    }
  }

  if (!document) {
    return <EmptyState title="Version History">Open or create a document before viewing versions.</EmptyState>;
  }

  return (
    <section className="home-subpage">
      <header className="home-subpage-header">
        <div>
          <h1>Version History</h1>
          <p>{activeDocument.title}</p>
        </div>
      </header>

      {!versions.length ? (
        <EmptyState title="No saved versions yet">DB-backed uploads and edits will append versions here.</EmptyState>
      ) : (
        <div className="version-list">
          {versions.map((version) => (
            <article className="version-item" key={version.id}>
              <div>
                <strong>Version {version.version_number}</strong>
                <p>{version.text_preview}</p>
                <time>{new Date(version.created_at).toLocaleString()}</time>
              </div>
              <div className="version-actions">
                <button type="button" onClick={() => handleView(version)}>View Difference</button>
                <button type="button" className="danger" onClick={() => setPendingRevert(version)}>Revert</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedVersion ? (
        <section className="version-diff">
          <article>
            <h2>Difference</h2>
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
            <h2>Version {selectedVersion.version_number}</h2>
            <pre>{snapshotText(selectedVersion) || 'No text snapshot is available for this version.'}</pre>
          </article>
        </section>
      ) : null}

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
