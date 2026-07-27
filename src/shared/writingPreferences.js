export const WRITING_PREFERENCE_SCHEMA_VERSION = 1;
export const WRITING_PREFERENCE_COMPILER_VERSION = 'writing-preferences-v1';
export const MAX_CUSTOM_WRITING_INSTRUCTIONS = 500;
export const DEFAULT_AUTOSAVE_DOCS = true;

export function resolveAutosaveDocs(value) {
  return typeof value === 'boolean' ? value : DEFAULT_AUTOSAVE_DOCS;
}

export const WRITING_PREFERENCE_FIELDS = Object.freeze([
  'audienceKnowledge',
  'domainContext',
  'vocabularyDensity',
  'sentenceStructure',
  'structuralPreference',
  'claimPosture',
  'feedbackDetail',
  'customInstructions',
]);

export const WRITING_PREFERENCE_OPTIONS = Object.freeze({
  audienceKnowledge: Object.freeze([
    { value: 'expert', label: 'Expert / Specialist' },
    { value: 'informed', label: 'Informed Reader' },
    { value: 'general', label: 'General Reader' },
  ]),
  domainContext: Object.freeze([
    { value: 'academic_research', label: 'Academic Research' },
    { value: 'cs_engineering', label: 'Computer Science / Engineering' },
    { value: 'business_product', label: 'Business / Product' },
    { value: 'general', label: 'General / No Domain' },
  ]),
  vocabularyDensity: Object.freeze([
    { value: 'high', label: 'Specialized' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'plain', label: 'Plain Language' },
  ]),
  sentenceStructure: Object.freeze([
    { value: 'compact', label: 'Compact' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'elaborated', label: 'Elaborated' },
  ]),
  structuralPreference: Object.freeze([
    { value: 'preserve_source', label: 'Preserve Original Structure' },
    { value: 'improve_flow', label: 'Improve Logical Flow' },
    { value: 'highly_structured', label: 'Strong Signposting' },
  ]),
  claimPosture: Object.freeze([
    { value: 'evidence_cautious', label: 'Evidence-Cautious' },
    { value: 'confident', label: 'Confident' },
    { value: 'neutral', label: 'Neutral' },
  ]),
  feedbackDetail: Object.freeze([
    { value: 'minimal', label: 'Rewrite Only' },
    { value: 'standard', label: 'Key Explanations' },
    { value: 'detailed', label: 'Detailed Guidance' },
  ]),
});

export const WRITING_PREFERENCE_LABELS = Object.freeze({
  audienceKnowledge: 'Audience knowledge',
  domainContext: 'Domain context',
  vocabularyDensity: 'Vocabulary density',
  sentenceStructure: 'Sentence structure',
  structuralPreference: 'Document structure',
  claimPosture: 'Claim posture',
  feedbackDetail: 'Feedback detail',
});

const OPTION_VALUES = Object.freeze(Object.fromEntries(
  Object.entries(WRITING_PREFERENCE_OPTIONS).map(([field, options]) => [
    field,
    new Set(options.map((option) => option.value)),
  ]),
));

const INSTRUCTIONS = Object.freeze({
  audienceKnowledge: {
    expert: 'assume specialist knowledge and retain established technical terms',
    informed: 'use domain terms but explain uncommon technical concepts',
    general: 'define jargon and favor broadly understandable wording',
  },
  domainContext: {
    academic_research: 'use research terminology, methodological precision, and cautious claims',
    cs_engineering: 'preserve technical names, identifiers, implementation details, and engineering terminology',
    business_product: 'emphasize outcomes, decisions, stakeholders, and practical impact',
    general: 'do not impose domain-specific conventions',
  },
  vocabularyDensity: {
    high: 'allow discipline-specific vocabulary where it improves precision',
    balanced: 'balance technical precision with readability',
    plain: 'prefer familiar wording while preserving exact meaning',
  },
  sentenceStructure: {
    compact: 'prefer shorter sentences with little clause nesting',
    balanced: 'mix short and moderately complex sentences',
    elaborated: 'allow developed sentence structures when precision requires them',
  },
  structuralPreference: {
    preserve_source: 'preserve the source order unless a local connection must be clarified',
    improve_flow: 'improve ordering and transitions where they strengthen coherence',
    highly_structured: 'use explicit transitions, topic sentences, and visible logical progression',
  },
  claimPosture: {
    evidence_cautious: 'distinguish evidence, interpretation, and uncertainty; avoid overstatement',
    confident: 'use decisive wording only where the source supports it',
    neutral: 'make no additional adjustment to claim strength',
  },
  feedbackDetail: {
    minimal: 'keep the required explanation to one short sentence',
    standard: 'explain only the most important changes',
    detailed: 'give concise sentence-level or category-level reasoning for important changes',
  },
});

const CUSTOM_INSTRUCTION_CONFLICT = /\b(?:ignore|disregard|override|replace)\b.{0,40}\b(?:instruction|rule|safety|rewrite mode|tone|output contract)\b|\b(?:system|developer)\s+(?:message|prompt)\b/iu;

function preferenceError(message) {
  return Object.assign(new TypeError(message), { status: 400, statusCode: 400 });
}

export function sanitizeCustomWritingInstructions(value) {
  const warnings = [];
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_CUSTOM_WRITING_INSTRUCTIONS);

  if (!normalized) return { value: '', warnings };
  if (CUSTOM_INSTRUCTION_CONFLICT.test(normalized)) {
    warnings.push('A conflicting custom instruction was omitted.');
    return { value: '', warnings };
  }
  return { value: normalized, warnings };
}

export function normalizeWritingPreferences(value, { strict = true } = {}) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw preferenceError('Writing preferences must be an object.');
  }

  if (strict) {
    const unknown = Object.keys(value).filter((field) => !WRITING_PREFERENCE_FIELDS.includes(field));
    if (unknown.length) throw preferenceError(`Unknown writing preference: ${unknown[0]}.`);
  }

  const normalized = {};
  for (const field of Object.keys(WRITING_PREFERENCE_OPTIONS)) {
    const candidate = value[field];
    if (candidate === null || candidate === undefined || candidate === '') continue;
    if (!OPTION_VALUES[field].has(candidate)) {
      throw preferenceError(`Invalid ${WRITING_PREFERENCE_LABELS[field].toLowerCase()} preference.`);
    }
    normalized[field] = candidate;
  }

  const custom = sanitizeCustomWritingInstructions(value.customInstructions);
  if (custom.value) normalized.customInstructions = custom.value;
  return normalized;
}

export function mergeWritingPreferences({
  savedPreferences,
  useSavedPreferences = true,
  preferenceOverrides,
}) {
  if (typeof useSavedPreferences !== 'boolean') {
    throw preferenceError('useSavedPreferences must be a boolean.');
  }
  const merged = useSavedPreferences
    ? normalizeWritingPreferences(savedPreferences, { strict: false })
    : {};
  if (preferenceOverrides === undefined || preferenceOverrides === null) return merged;
  if (typeof preferenceOverrides !== 'object' || Array.isArray(preferenceOverrides)) {
    throw preferenceError('preferenceOverrides must be an object.');
  }
  const unknown = Object.keys(preferenceOverrides)
    .filter((field) => !WRITING_PREFERENCE_FIELDS.includes(field));
  if (unknown.length) throw preferenceError(`Unknown writing preference: ${unknown[0]}.`);

  for (const field of WRITING_PREFERENCE_FIELDS) {
    if (!(field in preferenceOverrides)) continue;
    const candidate = preferenceOverrides[field];
    if (candidate === null || candidate === '') {
      delete merged[field];
      continue;
    }
    const normalized = normalizeWritingPreferences({ [field]: candidate });
    if (field in normalized) merged[field] = normalized[field];
    else delete merged[field];
  }
  return merged;
}

function resolveVocabularyInstruction(mode, value) {
  if (mode === 'accessible-concise' && value === 'high') {
    return 'retain necessary specialist terms but remove avoidable jargon and verbosity';
  }
  if (mode === 'formal-academic' && value === 'plain') {
    return 'prefer clear academic wording, never conversational or informal wording';
  }
  return INSTRUCTIONS.vocabularyDensity[value];
}

function resolveSentenceInstruction(mode, value) {
  if (mode === 'accessible-concise' && value === 'elaborated') {
    return 'remain concise first; use moderate complexity only when accuracy or qualification requires it';
  }
  return INSTRUCTIONS.sentenceStructure[value];
}

function resolveStructureInstruction(mode, value) {
  if (mode === 'persuasive-argumentative' && value === 'preserve_source') {
    return 'preserve the broad source order while strengthening local argument connections';
  }
  return INSTRUCTIONS.structuralPreference[value];
}

function resolveClaimInstruction(mode, value) {
  if (mode === 'formal-academic' && value === 'confident') {
    return 'use confidence only where supported; retain academic qualification and source fidelity';
  }
  if (mode === 'persuasive-argumentative' && value === 'evidence_cautious') {
    return 'strengthen reasoning without overstating the available evidence';
  }
  return INSTRUCTIONS.claimPosture[value];
}

export function compileWritingPreferenceSupplement(mode, preferences) {
  const effectivePreferences = normalizeWritingPreferences(preferences, { strict: false });
  const custom = sanitizeCustomWritingInstructions(effectivePreferences.customInstructions);
  const parts = [];

  if (effectivePreferences.audienceKnowledge) {
    parts.push(`Audience: ${INSTRUCTIONS.audienceKnowledge[effectivePreferences.audienceKnowledge]}`);
  }
  if (effectivePreferences.domainContext) {
    parts.push(`Domain: ${INSTRUCTIONS.domainContext[effectivePreferences.domainContext]}`);
  }
  if (effectivePreferences.vocabularyDensity) {
    parts.push(`Vocabulary: ${resolveVocabularyInstruction(mode, effectivePreferences.vocabularyDensity)}`);
  }
  if (effectivePreferences.sentenceStructure) {
    parts.push(`Sentences: ${resolveSentenceInstruction(mode, effectivePreferences.sentenceStructure)}`);
  }
  if (effectivePreferences.structuralPreference) {
    parts.push(`Structure: ${resolveStructureInstruction(mode, effectivePreferences.structuralPreference)}`);
  }
  if (effectivePreferences.claimPosture) {
    parts.push(`Claims: ${resolveClaimInstruction(mode, effectivePreferences.claimPosture)}`);
  }
  if (effectivePreferences.feedbackDetail) {
    parts.push(`Feedback: ${INSTRUCTIONS.feedbackDetail[effectivePreferences.feedbackDetail]}`);
  }
  if (custom.value) parts.push(`Additional writing constraint: ${custom.value}`);

  return {
    effectivePreferences,
    supplement: parts.length
      ? `Supplemental writing preferences (subordinate to the selected rewrite mode and source-fidelity rules): ${parts.join('; ')}.`
      : '',
    warnings: custom.warnings,
    schemaVersion: WRITING_PREFERENCE_SCHEMA_VERSION,
    compilerVersion: WRITING_PREFERENCE_COMPILER_VERSION,
  };
}

export function compileWritingPreferenceSetSupplement(preferences) {
  const base = compileWritingPreferenceSupplement('__all-rewrite-tones__', preferences);
  if (!base.supplement) return base;

  const effective = base.effectivePreferences;
  const toneOverrides = [];
  if (effective.vocabularyDensity === 'high') {
    toneOverrides.push(
      'Accessible & Concise: retain necessary specialist terms but remove avoidable jargon and verbosity',
    );
  } else if (effective.vocabularyDensity === 'plain') {
    toneOverrides.push(
      'Formal & Academic: prefer clear academic wording, never conversational or informal wording',
    );
  }
  if (effective.sentenceStructure === 'elaborated') {
    toneOverrides.push(
      'Accessible & Concise: remain concise first; use moderate complexity only when accuracy or qualification requires it',
    );
  }
  if (effective.structuralPreference === 'preserve_source') {
    toneOverrides.push(
      'Persuasive & Argumentative: preserve the broad source order while strengthening local argument connections',
    );
  }
  if (effective.claimPosture === 'confident') {
    toneOverrides.push(
      'Formal & Academic: use confidence only where supported; retain academic qualification and source fidelity',
    );
  } else if (effective.claimPosture === 'evidence_cautious') {
    toneOverrides.push(
      'Persuasive & Argumentative: strengthen reasoning without overstating the available evidence',
    );
  }

  return {
    ...base,
    supplement: toneOverrides.length
      ? `${base.supplement} Tone-specific precedence: ${toneOverrides.join('; ')}.`
      : base.supplement,
  };
}

export function writingPreferenceSummary(preferences) {
  const normalized = normalizeWritingPreferences(preferences, { strict: false });
  const summary = [];
  for (const [field, options] of Object.entries(WRITING_PREFERENCE_OPTIONS)) {
    if (!normalized[field]) continue;
    summary.push(options.find((option) => option.value === normalized[field])?.label ?? normalized[field]);
  }
  if (normalized.customInstructions) summary.push('Custom instructions');
  return summary;
}

export function stableWritingPreferenceValue(preferences) {
  const normalized = normalizeWritingPreferences(preferences, { strict: false });
  return Object.fromEntries(
    WRITING_PREFERENCE_FIELDS
      .filter((field) => field in normalized)
      .map((field) => [field, normalized[field]]),
  );
}

export function writingPreferenceCacheKey(preferences, enabled = true) {
  if (!enabled) return 'none';
  const stable = stableWritingPreferenceValue(preferences);
  return Object.keys(stable).length ? JSON.stringify(stable) : 'none';
}
