export default function ConfirmModal({ title, children, confirmLabel = 'Confirm', onCancel, onConfirm }) {
  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{children}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
