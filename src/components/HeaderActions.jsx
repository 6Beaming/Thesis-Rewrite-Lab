import { useRef } from 'react';

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.2 4.2" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M5 18.5h14" />
    </svg>
  );
}

export default function HeaderActions({
  query,
  onQueryChange,
  onNewDocument,
  onUpload,
  busy = false,
}) {
  const inputRef = useRef(null);

  function handleUploadClick() {
    inputRef.current?.click();
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (file) {
      onUpload?.(file);
    }
    event.target.value = '';
  }

  return (
    <div className="home-header-actions">
      <button type="button" className="home-new-doc" onClick={onNewDocument} disabled={busy}>
        <span aria-hidden="true">+</span>
        New doc
      </button>

      <button type="button" className="home-upload" onClick={handleUploadClick} disabled={busy}>
        <UploadIcon />
        Upload
      </button>
      <input
        ref={inputRef}
        className="home-file-input"
        type="file"
        accept=".txt,.md,.docx"
        onChange={handleFileChange}
      />

      <label className="home-search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search docs"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
    </div>
  );
}
