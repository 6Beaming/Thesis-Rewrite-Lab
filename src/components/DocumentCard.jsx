import DocumentMenu from './DocumentMenu.jsx';

function formatAge(value) {
  const date = value ? new Date(value) : new Date();
  const diff = Math.max(0, Date.now() - date.getTime());
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Today';
  const days = Math.floor(diff / day);
  if (days <= 7) return `${days} Days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks <= 4) return `${weeks} Weeks ago`;
  const months = Math.floor(days / 30);
  if (months <= 12) return `${months} Months ago`;
  return `${Math.floor(days / 365)} Years ago`;
}

function editedText(value) {
  const date = value ? new Date(value) : new Date();
  const minutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `Edited ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours} hours ago`;
  return `Edited ${Math.floor(hours / 24)} days ago`;
}

function textFromContent(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (!Array.isArray(node.content)) return '';
  return node.content.map(textFromContent).join(' ');
}

function documentPreview(document) {
  const blockText = Array.isArray(document.blocks)
    ? document.blocks.map((block) => block.text_content ?? block.text ?? '').join(' ')
    : '';
  const contentText = textFromContent(document.content_json);
  const source = blockText || contentText || document.snippet || document.secondarySnippet || '';
  const normalized = String(source).replace(/\s+/g, ' ').trim();

  if (!normalized) return 'No content yet.';
  return normalized.length > 100 ? `${normalized.slice(0, 100).trimEnd()}...` : normalized;
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h4" />
      <path d="M10 13h5" />
      <path d="M10 16h4" />
    </svg>
  );
}

export default function DocumentCard({
  document,
  onOpen,
  onDelete,
  showMenu = true,
  selected = false,
}) {
  const completedRate = Math.max(0, Math.min(100, Math.round(Number(document.completed_rate ?? 0) * 100)));
  const preview = documentPreview(document);

  return (
    <article
      className={`document-card${selected ? ' is-selected' : ''}`}
      onClick={() => onOpen?.(document)}
      tabIndex={0}
    >
      <span className="document-age">{formatAge(document.updated_at)}</span>
      <span className="document-completion-hover">{completedRate}% completed</span>
      {showMenu ? (
        <DocumentMenu onDelete={(event) => {
          event?.stopPropagation?.();
          onDelete?.(document);
        }} />
      ) : null}

      <div className="document-icon">
        <DocIcon />
      </div>
      <div className="document-content">
        <span className="document-style">{document.academic_style || 'APA'}</span>
        <h3>{document.title || 'Untitled document'}</h3>
        <p className="document-preview" title={preview}>{preview}</p>
        <time>{editedText(document.updated_at)}</time>
      </div>
    </article>
  );
}
