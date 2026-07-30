import { DropdownSelect } from './SortDropdown.jsx';

const OPTIONS = [
  { value: 'low', label: 'Broad' },
  { value: 'medium', label: 'Balanced' },
  { value: 'high', label: 'Focused' },
];

export default function SemanticProfileControl({
  value,
  onChange,
  busy,
  status,
  documentSummary,
}) {
  return (
    <section className="semantic-profile-control" aria-labelledby="semantic-profile-heading">
      <div className="semantic-profile-control__heading">
        <h2 id="semantic-profile-heading"><strong>Sentence grouping style</strong></h2>
        <p>Choose how closely related sentences should stay together during writing review.</p>
      </div>
      <label className="semantic-profile-control__field">
        <DropdownSelect
          value={value}
          options={OPTIONS}
          onChange={onChange}
          ariaLabel="Sentence grouping style"
          disabled={busy}
          wrapperClassName="dropdown-select semantic-profile-select-wrapper"
          triggerClassName="sort-dropdown-trigger semantic-profile-select-trigger"
          menuClassName="sort-dropdown-menu semantic-profile-select-menu"
        />
      </label>
      {status ? <small className="semantic-profile-control__status" role="status">{status}</small> : null}
      {documentSummary ? (
        <div className="semantic-profile-control__statistics-group">
          <strong>Global writing statistics</strong>
          <section className="semantic-profile-control__statistics" aria-label="Global writing statistics">
            <p>
              <strong>{documentSummary.passCount ?? 0} </strong>ready · <strong>{documentSummary.warningCount ?? 0} </strong>with suggestions ·{' '}
              <strong>{documentSummary.blockedCount ?? 0} </strong>needing changes · <strong>{documentSummary.skippedCount ?? 0} </strong>not needing review ·{' '}
              <strong>{documentSummary.unknownCount ?? 0} </strong>awaiting review
            </p>
          </section>
        </div>
      ) : null}
    </section>
  );
}
