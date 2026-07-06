import { useEffect, useMemo, useState } from 'react';
import { DropdownSelect } from './SortDropdown.jsx';
import TemplateCards from './TemplateCards.jsx';

export const DEFAULT_CUSTOM_STYLE = {
  margin: '1 inch',
  font: 'Times New Roman',
  spacing: '2.0',
  indentation: '0.5in',
  notes: 'Footnotes',
  pageNumber: 'Bottom center',
};

export const TEMPLATE_STYLE_SETTINGS = {
  APA: {
    margin: '1 inch',
    font: 'Times New Roman',
    spacing: '2.0',
    indentation: '0.5in',
    notes: 'Footnotes',
    pageNumber: 'Bottom center',
  },
  MLA: {
    margin: '1 inch',
    font: 'Times New Roman',
    spacing: '2.0',
    indentation: '0.5in',
    notes: 'Endnotes',
    pageNumber: 'Top right',
  },
  Chicago: {
    margin: '1 inch',
    font: 'Times New Roman',
    spacing: '1.5',
    indentation: '0.5in',
    notes: 'Footnotes',
    pageNumber: 'Bottom center',
  },
};

const styleOptions = {
  margin: ['1 inch', '0.75 inch', '1.25 inch'],
  font: ['Times New Roman', 'Georgia', 'Arial', 'Calibri'],
  spacing: ['1.0', '1.15', '1.5', '2.0'],
  indentation: ['0in', '0.25in', '0.5in'],
  notes: ['Footnotes', 'Endnotes', 'None'],
  pageNumber: ['Bottom center', 'Top right', 'Bottom right'],
};

export default function AcademicStylePanel({
  styleName = 'APA',
  customStyle = DEFAULT_CUSTOM_STYLE,
  onTemplateChange,
  onCustomStyleChange,
}) {
  const [mode, setMode] = useState('templates');
  const customSignature = useMemo(() => JSON.stringify(customStyle ?? {}), [customStyle]);
  const [custom, setCustom] = useState(() => ({ ...DEFAULT_CUSTOM_STYLE, ...customStyle }));

  useEffect(() => {
    setCustom({ ...DEFAULT_CUSTOM_STYLE, ...(customStyle ?? {}) });
  }, [customSignature]);

  function updateCustom(key, value) {
    const next = { ...custom, [key]: value };
    setCustom(next);
    onCustomStyleChange?.(next);
  }

  return (
    <section className="academic-style-panel" aria-label="Academic style settings">
      <div className="workspace-panel-tabs">
        <button type="button" className={mode === 'templates' ? 'is-active' : ''} onClick={() => setMode('templates')}>
          Templates
        </button>
        <button type="button" className={mode === 'custom' ? 'is-active' : ''} onClick={() => setMode('custom')}>
          Customized
        </button>
      </div>

      {mode === 'templates' ? (
        <TemplateCards selected={styleName} onSelect={onTemplateChange} />
      ) : (
        <div className="custom-style-grid">
          {Object.entries(styleOptions).map(([key, options]) => (
            <label key={key}>
              <span>{key.replace(/([A-Z])/g, ' $1')}</span>
              <DropdownSelect
                value={custom[key]}
                options={options.map((option) => ({ value: option, label: option }))}
                onChange={(value) => updateCustom(key, value)}
                ariaLabel={key.replace(/([A-Z])/g, ' $1')}
                wrapperClassName="dropdown-select custom-style-select-wrapper"
                triggerClassName="sort-dropdown-trigger custom-style-select-trigger"
                menuClassName="sort-dropdown-menu custom-style-select-menu"
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
