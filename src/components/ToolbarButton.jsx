export default function ToolbarButton({ label, icon, active = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      className={`editor-toolbar-button${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}
