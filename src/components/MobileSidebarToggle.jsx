export default function MobileSidebarToggle({
  open,
  onClick,
  className = '',
  ariaLabel = 'Toggle sidebar',
  variant = 'menu',
}) {
  return (
    <button
      type="button"
      className={`home-sidebar-toggle${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-expanded={open}
      aria-label={ariaLabel}
    >
      {variant === 'side' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="4" width="17" height="16" rx="2" />
          <path d="M9 4v16" />
          <path d={open ? 'm15 9-3 3 3 3' : 'm12 9 3 3-3 3'} />
        </svg>
      ) : (
        <>
          <span />
          <span />
          <span />
        </>
      )}
    </button>
  );
}
