import { useState } from 'react';
import ConfirmModal from '../components/ConfirmModal.jsx';
import DocumentCard from '../components/DocumentCard.jsx';
import { useRealtime } from '../components/RealtimeProvider.jsx';
import { deleteForever, restoreDocument } from '../services/trashApi.js';
import trashUrl from '../assets/trash.png?url';

export default function HomepageTrash({ onNotice, onChanged }) {
  const { state: realtimeState, applyDocument } = useRealtime();
  const documents = realtimeState.trashDocuments;
  const [selected, setSelected] = useState(null);
  const [localNotice, setLocalNotice] = useState('');
  const visibleNotice = localNotice || realtimeState.error;

  async function handleRestore(document) {
    try {
      const result = await restoreDocument(document.id);
      applyDocument('document:restored', result.document);
      onChanged?.();
    } catch (error) {
      const message = error.message || 'Restore failed.';
      setLocalNotice(message);
      onNotice?.(message);
    }
  }

  async function handleDeleteForever() {
    if (!selected) return;

    try {
      const result = await deleteForever(selected.id);
      applyDocument('document:deleted', result.document);
      setSelected(null);
      onChanged?.();
    } catch (error) {
      const message = error.message || 'Delete forever failed.';
      setLocalNotice(message);
      onNotice?.(message);
    }
  }

  const totalSize = documents.reduce((sum, document) => sum + Number(document.total_chars ?? 0), 0);

  if (!documents.length) {
    return (
      <section className="trash-empty-custom">
        <img className="trash-empty-icon" src={trashUrl} alt="" />
        <h1>{visibleNotice ? 'Could not load trash' : 'No items in trash'}</h1>
        {visibleNotice ? <p role="alert">{visibleNotice}</p> : null}
      </section>
    );
  }

  return (
    <section className="home-subpage">
      <header className="home-subpage-header">
        <div>
          <h1><strong>Trash</strong></h1>
          <p>{documents.length} items, {totalSize} characters</p>
        </div>
      </header>
      {visibleNotice ? <p className="trash-local-notice">{visibleNotice}</p> : null}
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
          {selected.title} will be permanently removed from the database.
        </ConfirmModal>
      ) : null}
    </section>
  );
}
