import ToolbarButton from './ToolbarButton.jsx';
import { useEffect, useState } from 'react';

function ToolIcon({ type }) {
  const icons = {
    bold: <text x="7" y="17" fontSize="14" fontWeight="700" fill="currentColor" stroke="none">B</text>,
    italic: <text x="9" y="17" fontSize="14" fontStyle="italic" fill="currentColor" stroke="none">I</text>,
    underline: (
      <>
        <text x="7" y="15" fontSize="13" fill="currentColor" stroke="none">U</text>
        <path d="M6 19h12" />
      </>
    ),
    heading: <path d="M5 18V6M19 18V6M5 12h14" />,
    bullet: <path d="M8 7h11M8 12h11M8 17h11M4.5 7h.1M4.5 12h.1M4.5 17h.1" />,
    ordered: <path d="M9 7h10M9 12h10M9 17h10M4 8h2M4 12h2M4 16h2" />,
    quote: <path d="M8 8c-2 1-3 3-3 6h4v-4H7c.2-1.2.7-2 1.8-2.7M17 8c-2 1-3 3-3 6h4v-4h-2c.2-1.2.7-2 1.8-2.7" />,
    left: <path d="M5 7h14M5 11h10M5 15h14M5 19h10" />,
    center: <path d="M5 7h14M7 11h10M5 15h14M7 19h10" />,
    right: <path d="M5 7h14M9 11h10M5 15h14M9 19h10" />,
    indent: <path d="M5 7h14M11 11h8M11 15h8M5 11l4 3-4 3" />,
    outdent: <path d="M5 7h14M11 11h8M11 15h8M9 11l-4 3 4 3" />,
    undo: <path d="M9 7H4v5M4 12c2-4 7-6 12-3 2 1 3 3 4 5" />,
    redo: <path d="M15 7h5v5M20 12c-2-4-7-6-12-3-2 1-3 3-4 5" />,
    break: <path d="M5 7h14M5 17h14M8 12h8M12 9v6" />,
    save: <path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6" />,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {icons[type]}
    </svg>
  );
}

const fontFamilies = ['Times New Roman', 'Georgia', 'Arial', 'Calibri'];
const fontSizes = ['10pt', '11pt', '12pt', '14pt', '16pt'];
const lineHeights = ['1.0', '1.15', '1.5', '2.0'];
const textColors = ['#111827', '#007a64', '#9a3328', '#1d4ed8'];
const highlightColors = ['#fff2a8', '#ccebdc', '#ffd6d1'];
const blockStatuses = ['processing', 'unprocessed', 'processed', 'skipped'];

export default function EditorToolbar({
  editor,
  activeBlockStatus = 'unprocessed',
  onBlockStatusChange,
  onSave,
  saveDisabled = false,
  saving = false,
}) {
  const [, setToolbarRevision] = useState(0);

  useEffect(() => {
    if (!editor) return undefined;

    const refreshToolbar = () => {
      setToolbarRevision((revision) => revision + 1);
    };

    editor.on('transaction', refreshToolbar);
    editor.on('selectionUpdate', refreshToolbar);
    return () => {
      editor.off('transaction', refreshToolbar);
      editor.off('selectionUpdate', refreshToolbar);
    };
  }, [editor]);

  if (!editor) return null;

  function setFontSize(value) {
    editor.chain().focus().setFontSize(value).run();
  }

  function insertPageBreak() {
    editor.chain().focus().insertContent({ type: 'pageBreak' }).run();
  }

  return (
    <section className="editor-toolbar" aria-label="Document editing toolbar">
      <div className="editor-toolbar-group">
        <ToolbarButton
          label={saving ? 'Saving' : 'Save'}
          icon={<ToolIcon type="save" />}
          disabled={saveDisabled || saving}
          onClick={onSave}
        />
        <ToolbarButton label="Bold" icon={<ToolIcon type="bold" />} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton label="Italic" icon={<ToolIcon type="italic" />} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton label="Underline" icon={<ToolIcon type="underline" />} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <ToolbarButton label="Heading" icon={<ToolIcon type="heading" />} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      </div>

      <div className="editor-toolbar-group">
        <select className="toolbar-select" aria-label="Font family" onChange={(event) => editor.chain().focus().setFontFamily(event.target.value).run()} defaultValue="Times New Roman">
          {fontFamilies.map((font) => <option key={font} value={font}>{font}</option>)}
        </select>
        <select className="toolbar-select" aria-label="Font size" onChange={(event) => setFontSize(event.target.value)} defaultValue="12pt">
          {fontSizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <select className="toolbar-select" aria-label="Line spacing" onChange={(event) => editor.chain().focus().updateAttributes('paragraph', { lineHeight: event.target.value }).run()} defaultValue="2.0">
          {lineHeights.map((height) => <option key={height} value={height}>{height}</option>)}
        </select>
      </div>

      <div className="editor-toolbar-group editor-toolbar-swatches" aria-label="Text color controls">
        {textColors.map((color) => (
          <button
            key={color}
            type="button"
            className="toolbar-swatch"
            style={{ '--swatch-color': color }}
            title={`Text color ${color}`}
            aria-label={`Text color ${color}`}
            onClick={() => editor.chain().focus().setColor(color).run()}
          />
        ))}
        <button type="button" className="toolbar-swatch toolbar-swatch--clear" title="Clear text color" aria-label="Clear text color" onClick={() => editor.chain().focus().unsetColor().run()}>
          /
        </button>
      </div>

      <div className="editor-toolbar-group editor-toolbar-swatches" aria-label="Highlight controls">
        {highlightColors.map((color) => (
          <button
            key={color}
            type="button"
            className="toolbar-swatch toolbar-swatch--highlight"
            style={{ '--swatch-color': color }}
            title={`Highlight ${color}`}
            aria-label={`Highlight ${color}`}
            onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
          />
        ))}
        <button type="button" className="toolbar-swatch toolbar-swatch--clear" title="Clear highlight" aria-label="Clear highlight" onClick={() => editor.chain().focus().unsetHighlight().run()}>
          /
        </button>
      </div>

      <div className="editor-toolbar-group">
        <ToolbarButton label="Align left" icon={<ToolIcon type="left" />} active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} />
        <ToolbarButton label="Align center" icon={<ToolIcon type="center" />} active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
        <ToolbarButton label="Align right" icon={<ToolIcon type="right" />} active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} />
        <ToolbarButton label="Bullet list" icon={<ToolIcon type="bullet" />} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton label="Ordered list" icon={<ToolIcon type="ordered" />} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarButton label="Block quote" icon={<ToolIcon type="quote" />} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      </div>

      <div className="editor-toolbar-group">
        <ToolbarButton label="Outdent" icon={<ToolIcon type="outdent" />} onClick={() => editor.chain().focus().updateAttributes('paragraph', { textIndent: '0in' }).run()} />
        <ToolbarButton label="Indent" icon={<ToolIcon type="indent" />} onClick={() => editor.chain().focus().updateAttributes('paragraph', { textIndent: '0.5in' }).run()} />
        <ToolbarButton label="Page break" icon={<ToolIcon type="break" />} onClick={insertPageBreak} />
        <select
          aria-label="Block status"
          className="toolbar-select editor-status-select"
          value={activeBlockStatus}
          onChange={(event) => onBlockStatusChange?.(event.target.value)}
        >
          {blockStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <ToolbarButton label="Undo" icon={<ToolIcon type="undo" />} disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
        <ToolbarButton label="Redo" icon={<ToolIcon type="redo" />} disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
      </div>
    </section>
  );
}
