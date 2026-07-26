export function languageIssueIdentity(issue = {}) {
  return [
    String(issue.code ?? ''),
    Number(issue.startCp) || 0,
    Number(issue.endCp) || 0,
    String(issue.original ?? ''),
    String(issue.suggestion ?? ''),
  ].join('|');
}

function statusForIssues(originalStatus, issues) {
  if (originalStatus === 'skipped') return 'skipped';
  if (issues.some((issue) => issue.severity === 'blocking')) return 'blocked';
  if (issues.length) return 'warning';
  return 'pass';
}

export function applyLanguageIssueRejections(snapshot = {}, rejectedIssues = []) {
  const identities = new Set(rejectedIssues.map((issue) => (
    typeof issue === 'string' ? issue : languageIssueIdentity(issue)
  )));
  if (!identities.size) return snapshot;
  const issues = (snapshot.issues ?? []).filter((issue) => (
    !identities.has(languageIssueIdentity(issue))
  ));
  const sentences = (snapshot.sentences ?? []).map((sentence) => {
    const sentenceIssues = (sentence.issues ?? []).filter((issue) => (
      !identities.has(languageIssueIdentity(issue))
    ));
    return {
      ...sentence,
      issues: sentenceIssues,
      status: sentence.status === 'skipped'
        ? 'skipped'
        : statusForIssues(sentence.status, sentenceIssues),
    };
  });
  const status = statusForIssues(snapshot.status, issues);
  return {
    ...snapshot,
    status,
    sentences,
    issues,
    issueCounts: {
      warning: issues.filter((issue) => issue.severity === 'warning').length,
      blocking: issues.filter((issue) => issue.severity === 'blocking').length,
    },
    rewriteEligible: status === 'pass' || status === 'warning',
    rejectedIssues: [...identities],
  };
}

export function rejectLanguageIssue(snapshot = {}, issue = {}) {
  const rejected = [
    ...(snapshot.rejectedIssues ?? []),
    languageIssueIdentity(issue),
  ];
  return applyLanguageIssueRejections(snapshot, rejected);
}
