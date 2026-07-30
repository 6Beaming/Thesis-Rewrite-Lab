const STATUS_LABELS = {
  unknown: 'Not reviewed',
  pass: 'Ready',
  warning: 'Suggestions available',
  blocked: 'Needs changes',
  skipped: 'Review not needed',
};

const CONNECTION_LABELS = {
  high: 'Strongly connected',
  medium: 'Moderately connected',
  low: 'Loosely connected',
};

const ISSUE_LABELS = {
  SPELLING_TYPO: 'Possible spelling issue',
  POSSIBLE_FRAGMENT: 'Possible incomplete sentence',
  UNMATCHED_DELIMITER: 'Unmatched punctuation',
  MISSING_END_PUNCTUATION: 'Possible missing ending punctuation',
};

function issueKey(issue, index) {
  return [
    issue.code,
    issue.startCp,
    issue.endCp,
    issue.original ?? '',
    issue.suggestion ?? '',
    index,
  ].join(':');
}

export default function NlpAnalysisPanel({
  snapshot,
  checkState,
  error,
  onRejectIssue,
  rejectingIssueKey,
}) {
  const issues = snapshot?.issues ?? [];
  const anchor = snapshot?.semanticAnchor;
  return (
    <div className="nlp-analysis-panel" aria-live="polite">
      <header className="nlp-analysis-panel__status">
        <div>
          <span className={`nlp-status-dot nlp-status-dot--${snapshot?.status ?? 'unknown'}`} />
          <strong>{STATUS_LABELS[snapshot?.status] ?? STATUS_LABELS.unknown}</strong>
        </div>
        <span>{checkState === 'checking' ? 'Reviewing…' : `${snapshot?.sentenceCount ?? 0} sentences`}</span>
      </header>
      {error ? <p className="analysis-error" role="alert">{error}</p> : null}
      {anchor?.topicTerms?.length ? (
        <section className="nlp-analysis-card nlp-analysis-card--anchor">
          <h3>Keywords</h3>
          <p>{anchor.topicTerms.join(' · ')}</p>
          <small>
            Sentence connection level: {CONNECTION_LABELS[anchor.confidence] ?? 'Connection identified'}
          </small>
        </section>
      ) : null}
      <section className="nlp-analysis-card nlp-analysis-card--diagnostics">
        <h3>Writing checks</h3>
        {issues.length ? (
          <ul className="nlp-issue-list">
            {issues.map((issue, index) => {
              const key = issueKey(issue, index);
              return (
                <li key={key} className={`is-${issue.severity}`}>
                  <strong>{ISSUE_LABELS[issue.code] ?? 'Writing suggestion'}</strong>
                  <span>{issue.message}</span>
                  {issue.suggestion ? <small>Suggested correction: {issue.suggestion}</small> : null}
                  {onRejectIssue ? (
                    <button
                      className="nlp-issue-reject"
                      type="button"
                      disabled={rejectingIssueKey === key}
                      onClick={() => onRejectIssue(issue, key)}
                    >
                      {rejectingIssueKey === key ? 'Removing…' : 'Reject suggestion'}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{checkState === 'checking' ? 'Reviewing the active block…' : 'No writing issues found.'}</p>
        )}
      </section>
    </div>
  );
}
