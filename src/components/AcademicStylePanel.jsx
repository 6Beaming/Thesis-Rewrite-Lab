import { useEffect, useMemo, useState } from 'react';
import { DropdownSelect } from './SortDropdown.jsx';
import TemplateCards from './TemplateCards.jsx';

export const DEFAULT_CUSTOM_STYLE = {
  marginPreset: 'Normal',
  marginTop: '1in',
  marginRight: '1in',
  marginBottom: '1in',
  marginLeft: '1in',
  font: 'Times New Roman',
  spacing: '2.0',
  indentation: '0.5in',
  pageNumber: 'Bottom center',
};

export const TEMPLATE_STYLE_SETTINGS = {
  APA: {
    ...DEFAULT_CUSTOM_STYLE,
    font: 'Times New Roman',
    spacing: '2.0',
    indentation: '0.5in',
    pageNumber: 'Bottom center',
  },
  MLA: {
    ...DEFAULT_CUSTOM_STYLE,
    font: 'Times New Roman',
    spacing: '2.0',
    indentation: '0.5in',
    pageNumber: 'Top right',
  },
  Chicago: {
    ...DEFAULT_CUSTOM_STYLE,
    font: 'Times New Roman',
    spacing: '1.5',
    indentation: '0.5in',
    pageNumber: 'Bottom center',
  },
};

const styleOptions = {
  indentation: ['0in', '0.25in', '0.5in'],
  pageNumber: ['Bottom center', 'Top right', 'Bottom right'],
};

const marginOptions = Array.from({ length: 26 }, (_, index) => {
  const inches = index / 10;
  const value = `${Number.isInteger(inches) ? inches : inches.toFixed(1)}in`;
  return { value, label: `${inches.toFixed(1)} in` };
});

const marginPresets = {
  Normal: ['1in', '1in', '1in', '1in'],
  Narrow: ['0.5in', '0.5in', '0.5in', '0.5in'],
  Moderate: ['1in', '0.8in', '1in', '0.8in'],
};

function normalizeMarginValue(value, fallback = '1in') {
  const match = /^(\d*\.?\d+)\s*(in|cm|mm|pt|px)$/i.exec(String(value ?? '').trim());
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const inches = unit === 'in'
    ? amount
    : unit === 'cm'
      ? amount / 2.54
      : unit === 'mm'
        ? amount / 25.4
        : unit === 'pt'
          ? amount / 72
          : amount / 96;
  const rounded = Math.min(2.5, Math.max(0, Math.round(inches * 10) / 10));
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}in`;
}

function normalizeLegacyStyle(style = {}) {
  const legacyMargin = String(style.margin ?? '').trim().replace(/\s*inch(?:es)?$/i, 'in');
  return {
    ...DEFAULT_CUSTOM_STYLE,
    ...style,
    marginTop: normalizeMarginValue(style.marginTop || legacyMargin, DEFAULT_CUSTOM_STYLE.marginTop),
    marginRight: normalizeMarginValue(style.marginRight || legacyMargin, DEFAULT_CUSTOM_STYLE.marginRight),
    marginBottom: normalizeMarginValue(style.marginBottom || legacyMargin, DEFAULT_CUSTOM_STYLE.marginBottom),
    marginLeft: normalizeMarginValue(style.marginLeft || legacyMargin, DEFAULT_CUSTOM_STYLE.marginLeft),
    notes: undefined,
  };
}

export default function AcademicStylePanel({
  styleName = 'APA',
  customStyle = DEFAULT_CUSTOM_STYLE,
  onTemplateChange,
  onCustomStyleChange,
}) {
  const [mode, setMode] = useState('templates');
  const customSignature = useMemo(() => JSON.stringify(customStyle ?? {}), [customStyle]);
  const [custom, setCustom] = useState(() => normalizeLegacyStyle(customStyle));

  useEffect(() => {
    setCustom(normalizeLegacyStyle(customStyle));
  }, [customSignature]);

  function updateCustom(key, value) {
    let next = { ...custom, [key]: value };
    if (key === 'marginPreset' && marginPresets[value]) {
      const [marginTop, marginRight, marginBottom, marginLeft] = marginPresets[value];
      next = { ...next, marginTop, marginRight, marginBottom, marginLeft };
    }
    if (key.startsWith('margin') && key !== 'marginPreset') {
      next.marginPreset = 'Custom';
    }
    delete next.margin;
    delete next.notes;
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
          <label>
            <span>Margin preset</span>
            <DropdownSelect
              value={custom.marginPreset}
              options={['Normal', 'Narrow', 'Moderate', 'Custom'].map((value) => ({ value, label: value }))}
              onChange={(value) => updateCustom('marginPreset', value)}
              ariaLabel="Margin preset"
              wrapperClassName="dropdown-select custom-style-select-wrapper"
              triggerClassName="sort-dropdown-trigger custom-style-select-trigger"
              menuClassName="sort-dropdown-menu custom-style-select-menu"
            />
          </label>
          {['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].map((key) => (
            <label key={key}>
              <span>{key.replace('margin', 'Margin ')}</span>
              <DropdownSelect
                value={custom[key]}
                options={marginOptions}
                onChange={(value) => updateCustom(key, value)}
                ariaLabel={key.replace('margin', 'Margin ')}
                wrapperClassName="dropdown-select custom-style-select-wrapper"
                triggerClassName="sort-dropdown-trigger custom-style-select-trigger"
                menuClassName="sort-dropdown-menu custom-style-select-menu custom-style-margin-menu"
              />
            </label>
          ))}
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
