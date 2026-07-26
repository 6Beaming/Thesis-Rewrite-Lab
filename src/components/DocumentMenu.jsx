import { useEffect, useRef, useState } from 'react';

export default function DocumentMenu({ onDelete, onExport, exporting = false }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsideClick(event) {
      if (!menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, [open]);

  return (
    <div className="document-menu" ref={menuRef}>
      <button
        type="button"
        className="document-menu-trigger"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-label="Document options"
      >
        ...
      </button>
      {open ? (
        <div className="document-menu-popover" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={onDelete}>Delete</button>
          <button
            type="button"
            disabled={exporting}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onExport?.(event);
            }}
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
