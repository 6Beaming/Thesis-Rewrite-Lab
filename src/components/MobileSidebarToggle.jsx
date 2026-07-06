export default function MobileSidebarToggle({ open, onClick, className = '', ariaLabel = 'Toggle sidebar' }) {
  return (
    <button
      type="button"
      className={`home-sidebar-toggle${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-expanded={open}
      aria-label={ariaLabel}
    >
      <span />
      <span />
      <span />
    </button>
  );
}
