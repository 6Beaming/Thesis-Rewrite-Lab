import { createHash } from 'node:crypto';

export function hashNlpText(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function countCodePoints(value) {
  return Array.from(String(value ?? '')).length;
}

export function codePointOffset(value, utf16Offset) {
  return Array.from(String(value ?? '').slice(0, Math.max(0, utf16Offset))).length;
}

export function codeUnitOffset(value, cpOffset) {
  return Array.from(String(value ?? ''))
    .slice(0, Math.max(0, cpOffset))
    .join('')
    .length;
}

export function sliceCodePoints(value, startCp, endCp) {
  return Array.from(String(value ?? '')).slice(startCp, endCp).join('');
}

export function stableFingerprint(value) {
  function stable(input) {
    if (Array.isArray(input)) return input.map(stable);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, stable(input[key])]),
    );
  }
  return hashNlpText(JSON.stringify(stable(value)));
}
