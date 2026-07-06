import DocumentCard from './DocumentCard.jsx';
import SortDropdown from './SortDropdown.jsx';

function BriefcaseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7V5h6v2" />
      <path d="M5 7h14v12H5z" />
      <path d="M5 12h14" />
      <path d="M10 12v2h4v-2" />
    </svg>
  );
}

export default function DocumentsSection({
  documents,
  sort,
  onSortChange,
  onOpenDocument,
  onDeleteDocument,
}) {
  return (
    <section className="documents-section">
      <div className="documents-heading">
        <h2>
          <BriefcaseIcon />
          Your documents
        </h2>
        <SortDropdown value={sort} onChange={onSortChange} />
      </div>

      <div className="documents-grid">
        {documents.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            onOpen={onOpenDocument}
            onDelete={onDeleteDocument}
          />
        ))}
      </div>
    </section>
  );
}
