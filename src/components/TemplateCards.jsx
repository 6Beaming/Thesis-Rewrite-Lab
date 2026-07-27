const templates = [
  { id: 'APA', title: 'APA', detail: 'Double-spaced with 1-inch margins and hanging references.' },
  { id: 'MLA', title: 'MLA', detail: 'Double-spaced with indented quotes and hanging works cited.' },
  { id: 'Chicago', title: 'Chicago', detail: 'Double-spaced body with student-paper notes and bibliography.' },
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
