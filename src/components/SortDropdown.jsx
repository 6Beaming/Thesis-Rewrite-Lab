import { useEffect, useMemo, useRef, useState } from 'react';

const options = [
  { value: 'most_recent', label: 'Most recent' },
  { value: 'least_recent', label: 'Least recent' },
  { value: 'most_completed', label: 'Most completed' },
  { value: 'least_completed', label: 'Least completed' },
];

function DownArrowIcon({ className = 'sort-dropdown-arrow' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function DropdownSelect({
  value,
  options: dropdownOptions,
  onChange,
  ariaLabel,
  triggerClassName = 'sort-dropdown-trigger',
  menuClassName = 'sort-dropdown-menu',
  wrapperClassName = 'dropdown-select',
  arrowClassName = 'sort-dropdown-arrow',
  menuRole = 'menu',
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const selected = useMemo(
    () => dropdownOptions.find((option) => option.value === value) ?? dropdownOptions[0],
    [dropdownOptions, value],
  );

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, []);

  return (
    <div className={wrapperClassName} ref={menuRef}>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {selected.label}
        <DownArrowIcon className={arrowClassName} />
      </button>
      {open ? (
        <div className={menuClassName} role={menuRole}>
          {dropdownOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === value ? 'is-selected' : ''}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="menuitemradio"
              aria-checked={option.value === value}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function SortDropdown({ value, onChange }) {
  return (
    <div className="sort-dropdown">
      <span>Sort by:</span>
      <DropdownSelect
        value={value}
        options={options}
        onChange={onChange}
        ariaLabel="Sort documents"
      />
    </div>
  );
}
