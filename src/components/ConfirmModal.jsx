export default function ConfirmModal({
  title,
  children,
  confirmLabel = 'Confirm',
  alternateLabel = null,
  modalClassName = '',
  onCancel,
  onConfirm,
  onAlternate = null,
}) {
  return (
    <div className="confirm-backdrop" role="presentation">
      <section
        className={`confirm-modal${modalClassName ? ` ${modalClassName}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2>{title}</h2>
        <p>{children}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          {alternateLabel && onAlternate ? (
            <button type="button" className="primary" onClick={onAlternate}>{alternateLabel}</button>
          ) : null}
          <button type="button" className="danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
