export default function HistorySelector({
  documents = [],
  expanded = false,
  onSelect,
  onViewAll,
}) {
  const visibleDocuments = expanded ? documents : documents.slice(0, 3);

  return (
    <section className="history-selector" aria-label="Recent documents">
      <div className="workspace-panel-heading">
        <h2> <strong>Other documents</strong></h2>
        <button type="button" onClick={onViewAll}>
          {expanded ? 'Collapse' : 'View all'}
        </button>
      </div>
      <div className={`history-list${expanded ? ' history-list--expanded' : ''}`}>
        {visibleDocuments.map((document) => (
          <button key={document.id} type="button" onClick={() => onSelect?.(document)}>
            <strong>{document.title}</strong>
            <span>{new Date(document.updated_at || Date.now()).toLocaleDateString()}</span>
          </button>
        ))}
        {!visibleDocuments.length ? (
          <p className="history-empty">No other recent documents yet.</p>
        ) : null}
      </div>
    </section>
  );
}
