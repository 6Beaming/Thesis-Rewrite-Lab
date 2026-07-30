import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

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
  disabled = false,
  fixedMenu = false,
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(undefined);
  const menuRef = useRef(null);
  const floatingMenuRef = useRef(null);
  const selected = useMemo(
    () => dropdownOptions.find((option) => option.value === value) ?? dropdownOptions[0],
    [dropdownOptions, value],
  );

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (
        !menuRef.current?.contains(event.target)
        && !floatingMenuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open || !fixedMenu || !menuRef.current) return undefined;

    function updateMenuPosition() {
      const rect = menuRef.current?.getBoundingClientRect();
      if (!rect) return;

      const viewportPadding = 8;
      const menuWidth = Math.min(190, window.innerWidth - (viewportPadding * 2));
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding),
      );

      setMenuStyle({
        position: 'fixed',
        top: `${rect.bottom + 8}px`,
        right: 'auto',
        left: `${left}px`,
        zIndex: 130,
        minWidth: `${menuWidth}px`,
      });
    }

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [fixedMenu, open]);

  const dropdownMenu = open && !disabled ? (
    <div
      ref={fixedMenu ? floatingMenuRef : undefined}
      className={menuClassName}
      role={menuRole}
      style={fixedMenu ? menuStyle : undefined}
    >
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
  ) : null;

  return (
    <div className={wrapperClassName} ref={menuRef}>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="dropdown-select-label">{selected.label}</span>
        <DownArrowIcon className={arrowClassName} />
      </button>
      {fixedMenu
        ? dropdownMenu && menuStyle
          ? createPortal(dropdownMenu, document.body)
          : null
        : dropdownMenu}
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
