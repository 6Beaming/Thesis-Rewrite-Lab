import { useEffect, useMemo, useState } from 'react';
import {
  MAX_CUSTOM_WRITING_INSTRUCTIONS,
  normalizeWritingPreferences,
  WRITING_PREFERENCE_LABELS,
  WRITING_PREFERENCE_OPTIONS,
  writingPreferenceSummary,
} from '../../shared/writingPreferences.js';
import { DropdownSelect } from '../components/SortDropdown.jsx';

const FIELD_ORDER = [
  'audienceKnowledge',
  'domainContext',
  'vocabularyDensity',
  'sentenceStructure',
  'structuralPreference',
  'claimPosture',
  'feedbackDetail',
];

function settingsFromUser(user) {
  return {
    autosaveDocs: Boolean(user?.autosaveDocs),
    writingPreferences: normalizeWritingPreferences(
      user?.writingPreferences,
      { strict: false },
    ),
  };
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="writing-preference-toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="writing-preference-toggle-track" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}

export default function HomepageWritingPreferences({
  user,
  onBack,
  onSave,
}) {
  const [settings, setSettings] = useState(() => settingsFromUser(user));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSettings(settingsFromUser(user));
  }, [
    user?.autosaveDocs,
    user?.writingPreferences,
  ]);

  const activeSummary = useMemo(
    () => writingPreferenceSummary(settings.writingPreferences),
    [settings.writingPreferences],
  );

  function updatePreference(field, value) {
    setSettings((current) => {
      const writingPreferences = { ...current.writingPreferences };
      if (value) writingPreferences[field] = value;
      else delete writingPreferences[field];
      return { ...current, writingPreferences };
    });
    setMessage('');
  }

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const saved = await onSave?.(settings);
      if (saved === false) return;
      onBack?.();
    } catch (error) {
      setMessage(error.message || 'Could not save writing preferences.');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setSettings({
      autosaveDocs: false,
      writingPreferences: {},
    });
    setMessage('Defaults restored. Save to apply them.');
  }

  return (
    <section className="writing-preferences-page" aria-labelledby="writing-preferences-title">
      <header className="writing-preferences-header">
        <div>
          <h2 id="writing-preferences-title">Writing preferences</h2>
          <p>Set defaults for every document and refine—not replace—the selected rewrite tone.</p>
        </div>
      </header>

      <div className="writing-preferences-scroll">
        <Toggle
          checked={settings.autosaveDocs}
          onChange={(autosaveDocs) => setSettings((current) => ({ ...current, autosaveDocs }))}
          label="Autosave for docs"
          description="Save document changes after a short pause. When off, Save remains fully manual."
        />

        <div className="writing-preferences-summary" aria-live="polite">
          <strong>Applied globally</strong>
          <span>
            {activeSummary.length
              ? activeSummary.join(' · ')
              : 'No supplemental writing constraints selected.'}
          </span>
        </div>

        <div className="writing-preferences-fields">
          {FIELD_ORDER.map((field) => (
            <label key={field}>
              <span>{WRITING_PREFERENCE_LABELS[field]}</span>
              <DropdownSelect
                value={settings.writingPreferences[field] ?? ''}
                options={[
                  { value: '', label: 'No preference' },
                  ...WRITING_PREFERENCE_OPTIONS[field],
                ]}
                onChange={(value) => updatePreference(field, value)}
                ariaLabel={WRITING_PREFERENCE_LABELS[field]}
                wrapperClassName="dropdown-select custom-style-select-wrapper writing-preference-select-wrapper"
                triggerClassName="sort-dropdown-trigger custom-style-select-trigger writing-preference-select-trigger"
                menuClassName="sort-dropdown-menu custom-style-select-menu writing-preference-select-menu"
              />
            </label>
          ))}
        </div>

        <label className="writing-preferences-custom">
          <span>Custom writing instructions</span>
          <textarea
            value={settings.writingPreferences.customInstructions ?? ''}
            onChange={(event) => updatePreference('customInstructions', event.target.value)}
            maxLength={MAX_CUSTOM_WRITING_INSTRUCTIONS}
            placeholder="Example: Preserve established API names and TypeScript identifiers exactly."
          />
          <small>
            {(settings.writingPreferences.customInstructions ?? '').length}
            /{MAX_CUSTOM_WRITING_INSTRUCTIONS}
          </small>
        </label>

        {message ? <p className="writing-preferences-message" role="status">{message}</p> : null}

        <div className="confirm-actions writing-preferences-actions">
          <button type="button" onClick={reset} disabled={saving}>Reset to defaults</button>
          <button type="button" className="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </div>
    </section>
  );
}
