import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_AUTOSAVE_DOCS,
  MAX_CUSTOM_WRITING_INSTRUCTIONS,
  normalizeWritingPreferences,
  resolveAutosaveDocs,
  WRITING_PREFERENCE_LABELS,
  WRITING_PREFERENCE_OPTIONS,
  writingPreferenceSummary,
} from '../shared/writingPreferences.js';
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
    autosaveDocs: resolveAutosaveDocs(user?.autosaveDocs),
    writingPreferences: normalizeWritingPreferences(
      user?.writingPreferences,
      { strict: false },
    ),
  };
}

function settingsSignature(settings) {
  return JSON.stringify(settings);
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
  const settingsRef = useRef(settings);
  const saveQueueRef = useRef(Promise.resolve(true));
  const queuedSignatureRef = useRef(settingsSignature(settings));
  const lastSavedSignatureRef = useRef(settingsSignature(settings));
  const latestSaveIdRef = useRef(0);
  const pendingSaveCountRef = useRef(0);
  const customSaveTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (pendingSaveCountRef.current > 0 || customSaveTimerRef.current) return;
    const nextSettings = settingsFromUser(user);
    const signature = settingsSignature(nextSettings);
    settingsRef.current = nextSettings;
    queuedSignatureRef.current = signature;
    lastSavedSignatureRef.current = signature;
    setSettings(nextSettings);
  }, [
    user?.autosaveDocs,
    user?.writingPreferences,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!customSaveTimerRef.current) return;
      clearTimeout(customSaveTimerRef.current);
      customSaveTimerRef.current = null;
      const latestSettings = settingsRef.current;
      const signature = settingsSignature(latestSettings);
      if (signature === queuedSignatureRef.current) return;
      queuedSignatureRef.current = signature;
      const persist = () => onSaveRef.current?.(latestSettings);
      saveQueueRef.current = saveQueueRef.current
        .then(persist, persist)
        .catch(() => false);
    };
  }, []);

  const activeSummary = useMemo(
    () => writingPreferenceSummary(settings.writingPreferences),
    [settings.writingPreferences],
  );

  function queueSettingsSave(nextSettings) {
    const signature = settingsSignature(nextSettings);
    if (signature === queuedSignatureRef.current) return saveQueueRef.current;

    queuedSignatureRef.current = signature;
    const saveId = latestSaveIdRef.current + 1;
    latestSaveIdRef.current = saveId;
    pendingSaveCountRef.current += 1;
    if (mountedRef.current) {
      setSaving(true);
      setMessage('Saving changes...');
    }

    const persist = async () => {
      try {
        const saved = await onSaveRef.current?.(nextSettings);
        if (saved === false) throw new Error('Could not save writing preferences.');
        lastSavedSignatureRef.current = signature;
        if (mountedRef.current && latestSaveIdRef.current === saveId) {
          setMessage('Preferences saved.');
        }
        return true;
      } catch (error) {
        if (latestSaveIdRef.current === saveId) {
          queuedSignatureRef.current = lastSavedSignatureRef.current;
          if (mountedRef.current) {
            setMessage(error.message || 'Could not save writing preferences.');
          }
        }
        return false;
      } finally {
        pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
        if (mountedRef.current) {
          setSaving(pendingSaveCountRef.current > 0);
        }
      }
    };

    const queued = saveQueueRef.current.then(persist, persist);
    saveQueueRef.current = queued;
    return queued;
  }

  function applySettings(nextSettings, { debounce = false } = {}) {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setMessage('');
    if (customSaveTimerRef.current) {
      clearTimeout(customSaveTimerRef.current);
      customSaveTimerRef.current = null;
    }
    if (!debounce) {
      void queueSettingsSave(nextSettings);
      return;
    }
    customSaveTimerRef.current = setTimeout(() => {
      customSaveTimerRef.current = null;
      void queueSettingsSave(settingsRef.current);
    }, 450);
  }

  function updatePreference(field, value) {
    const writingPreferences = { ...settingsRef.current.writingPreferences };
    if (value) writingPreferences[field] = value;
    else delete writingPreferences[field];
    applySettings(
      { ...settingsRef.current, writingPreferences },
      { debounce: field === 'customInstructions' },
    );
  }

  async function save() {
    if (customSaveTimerRef.current) {
      clearTimeout(customSaveTimerRef.current);
      customSaveTimerRef.current = null;
    }
    const saved = await queueSettingsSave(settingsRef.current);
    if (saved !== false) onBack?.();
  }

  function reset() {
    applySettings({
      autosaveDocs: DEFAULT_AUTOSAVE_DOCS,
      writingPreferences: {},
    });
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
          onChange={(autosaveDocs) => applySettings({ ...settingsRef.current, autosaveDocs })}
          label="Autosave for docs"
          description="Automatically save your progress as you write. Turn off to save manually."
        />

        <div className="writing-preferences-summary" aria-live="polite">
          <strong>Your preferences</strong>
          <span>
            {activeSummary.length
              ? activeSummary.join(' · ')
              : "You haven't set any custom writing guidelines yet."}
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
            onBlur={() => {
              if (!customSaveTimerRef.current) return;
              clearTimeout(customSaveTimerRef.current);
              customSaveTimerRef.current = null;
              void queueSettingsSave(settingsRef.current);
            }}
            maxLength={MAX_CUSTOM_WRITING_INSTRUCTIONS}
            placeholder="Maintain a persuasive but objective tone, avoiding first-person pronouns."
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
