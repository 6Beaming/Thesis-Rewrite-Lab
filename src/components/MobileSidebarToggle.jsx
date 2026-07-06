export default function MobileSidebarToggle({ open, onClick }) {
  return (
    <button
      type="button"
      className={`home-sidebar-toggle${open ? ' is-open' : ''}`}
      onClick={onClick}
      aria-expanded={open}
      aria-label="Toggle sidebar"
    >
      <span />
      <span />
      <span />
    </button>
  );
}
