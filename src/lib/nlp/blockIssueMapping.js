function codeUnitOffset(value, codePointOffset) {
  return Array.from(String(value ?? '')).slice(0, Math.max(0, codePointOffset)).join('').length;
}

export function mapBlockIssuesToEditorRanges(block, issues = []) {
  const text = String(block?.text ?? '');
  const contentStart = Number(block?.pos ?? 0) + 1;
  return issues
    .filter((issue) => (
      Number.isInteger(issue.startCp)
      && Number.isInteger(issue.endCp)
      && issue.endCp > issue.startCp
    ))
    .map((issue) => ({
      ...issue,
      from: contentStart + codeUnitOffset(text, issue.startCp),
      to: contentStart + codeUnitOffset(text, issue.endCp),
      blockId: block.blockId,
    }))
    .filter((issue) => issue.to > issue.from);
}
