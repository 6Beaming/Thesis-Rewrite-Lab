import { useEffect, useMemo, useRef, useState } from 'react';

const options = [
  { value: 'most_recent', label: 'Most Recent' },
  { value: 'least_recent', label: 'Least Recent' },
  { value: 'most_completed', label: 'Most Completed' },
  { value: 'least_completed', label: 'Least Completed' },
];

function DownArrowIcon() {
  return (
    <svg className="sort-dropdown-arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default function SortDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [value],
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
    <div className="sort-dropdown" ref={menuRef}>
      <span>Sort by:</span>
      <button
        type="button"
        className="sort-dropdown-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {selected.label}
        <DownArrowIcon />
      </button>
      {open ? (
        <div className="sort-dropdown-menu" role="menu">
          {options.map((option) => (
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
