const templates = [
  { id: 'APA', title: 'APA', detail: 'Double spaced, serif body, first-line indent.' },
  { id: 'MLA', title: 'MLA', detail: 'Readable humanities layout with simple citations.' },
  { id: 'Chicago', title: 'Chicago', detail: 'Footnote-friendly manuscript structure.' },
];

export default function TemplateCards({ selected = 'APA', onSelect }) {
  return (
    <div className="template-cards">
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          className={`template-card${selected === template.id ? ' is-selected' : ''}`}
          onClick={() => onSelect?.(template.id)}
        >
          <strong>{template.title}</strong>
          <span>{template.detail}</span>
        </button>
      ))}
    </div>
  );
}
