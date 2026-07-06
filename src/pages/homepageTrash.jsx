import { useEffect, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal.jsx';
import DocumentCard from '../components/DocumentCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { deleteForever, listTrash, restoreDocument } from '../services/trashApi.js';
import trashUrl from '../assets/trash.png?url';

export default function HomepageTrash({
  demoDocuments = [],
  onDemoRestore,
  onDemoDeleteForever,
  onNotice,
}) {
  const [documents, setDocuments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [usingDemoTrash, setUsingDemoTrash] = useState(false);
  const [localNotice, setLocalNotice] = useState('');

  useEffect(() => {
    let alive = true;
    listTrash()
      .then((data) => {
        if (!alive) return;
        setUsingDemoTrash(false);
        setDocuments(data.documents ?? []);
        setLocalNotice('');
      })
      .catch(() => {
        if (!alive) return;
        setUsingDemoTrash(true);
        setDocuments(demoDocuments);
        setLocalNotice('Trash is showing local demo items until PostgreSQL is connected.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [demoDocuments, onNotice]);

  async function handleRestore(document) {
    if (usingDemoTrash || document.id?.startsWith('demo-')) {
      onDemoRestore?.(document);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      return;
    }

    try {
      await restoreDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (error) {
      onNotice?.(error.message || 'Restore failed.');
    }
  }

  async function handleDeleteForever() {
    if (!selected) return;

    if (usingDemoTrash || selected.id?.startsWith('demo-')) {
      onDemoDeleteForever?.(selected);
      setDocuments((current) => current.filter((item) => item.id !== selected.id));
      setSelected(null);
      return;
    }

    try {
      await deleteForever(selected.id);
      setDocuments((current) => current.filter((item) => item.id !== selected.id));
      setSelected(null);
    } catch (error) {
      onNotice?.(error.message || 'Delete forever failed.');
    }
  }

  const totalSize = documents.reduce((sum, document) => sum + Number(document.total_chars ?? 0), 0);

  if (!loading && !documents.length) {
    return (
      <EmptyState title="No items in trash">
        <img className="trash-empty-icon" src={trashUrl} alt="" />
      </EmptyState>
    );
  }

  return (
    <section className="home-subpage">
      <header className="home-subpage-header">
        <div>
          <h1>Trash</h1>
          <p>{documents.length} items, {totalSize} characters</p>
        </div>
      </header>
      {localNotice ? <p className="trash-local-notice">{localNotice}</p> : null}
      <div className="trash-grid">
        {documents.map((document) => (
          <div className="trash-card-wrap" key={document.id}>
            <DocumentCard document={document} onOpen={() => {}} onDelete={() => setSelected(document)} />
            <div className="trash-card-actions">
              <button type="button" onClick={() => handleRestore(document)}>Restore</button>
              <button type="button" className="danger" onClick={() => setSelected(document)}>Delete Forever</button>
            </div>
          </div>
        ))}
      </div>
      {selected ? (
        <ConfirmModal
          title="Delete forever?"
          confirmLabel="Delete Forever"
          onCancel={() => setSelected(null)}
          onConfirm={handleDeleteForever}
        >
          {selected.title} will be permanently removed from {usingDemoTrash ? 'local demo data' : 'the local database'}.
        </ConfirmModal>
      ) : null}
    </section>
  );
}
