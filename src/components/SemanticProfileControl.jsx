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
}) {
  return (
    <section className="semantic-profile-control" aria-labelledby="semantic-profile-heading">
      <div className="semantic-profile-control__heading">
        <h2 id="semantic-profile-heading"> <strong>Sentence grouping style</strong></h2>
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
    </section>
  );
}
