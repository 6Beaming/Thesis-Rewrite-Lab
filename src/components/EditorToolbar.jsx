import ToolbarButton from './ToolbarButton.jsx';
import { useEffect, useState } from 'react';
import { DropdownSelect } from './SortDropdown.jsx';

function ToolIcon({ type }) {
  const icons = {
    bold: <text x="6.5" y="18" fontSize="15.5" fontWeight="700" fill="currentColor" stroke="none">B</text>,
    italic: <text x="8.5" y="18" fontSize="15.5" fontStyle="italic" fill="currentColor" stroke="none">I</text>,
    underline: (
      <>
        <text x="6.7" y="16" fontSize="14.5" fill="currentColor" stroke="none">U</text>
        <path d="M5.5 19h13" />
      </>
    ),
    heading: <path d="M5 18V6M19 18V6M5 12h14" />,
    bullet: <path d="M8 7h11M8 12h11M8 17h11M4.5 7h.1M4.5 12h.1M4.5 17h.1" />,
    ordered: <path d="M9 7h10M9 12h10M9 17h10M4 8h2M4 12h2M4 16h2" />,
    quote: <path d="M8 8c-2 1-3 3-3 6h4v-4H7c.2-1.2.7-2 1.8-2.7M17 8c-2 1-3 3-3 6h4v-4h-2c.2-1.2.7-2 1.8-2.7" />,
    left: <path d="M5 7h14M5 11h10M5 15h14M5 19h10" />,
    center: <path d="M5 7h14M7 11h10M5 15h14M7 19h10" />,
    right: <path d="M5 7h14M9 11h10M5 15h14M9 19h10" />,
    justify: <path d="M5 7h14M5 11h14M5 15h14M5 19h14" />,
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

const fontFamilies = [
  'Times New Roman',
  'Georgia',
  'Garamond',
  'Cambria',
  'Arial',
  'Calibri',
  'Helvetica',
  'Verdana',
  'Courier New',
];
const fontSizes = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '32pt'];
const lineHeights = ['1.0', '1.15', '1.5', '2.0'];
const textColors = ['#000000', '#008000', '#ffff00', '#ff0000'];
const highlightColors = ['#fff2a8', '#ccebdc', '#ffd6d1'];

const fontFamilyOptions = fontFamilies.map((font) => ({ value: font, label: font }));
const fontSizeOptions = fontSizes.map((size) => ({ value: size, label: size }));
const lineHeightOptions = lineHeights.map((height) => ({ value: height, label: height }));
const headingOptions = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: '1', label: 'Heading 1' },
  { value: '2', label: 'Heading 2' },
  { value: '3', label: 'Heading 3' },
];

export default function EditorToolbar({
  editor,
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

  const paragraphAttrs = editor.getAttributes('paragraph');
  const headingAttrs = editor.getAttributes('heading');
  const textStyleAttrs = editor.getAttributes('textStyle');
  const currentFontFamily = textStyleAttrs.fontFamily || paragraphAttrs.fontFamily || headingAttrs.fontFamily || 'Times New Roman';
  const currentFontSize = textStyleAttrs.fontSize || paragraphAttrs.fontSize || headingAttrs.fontSize || '12pt';
  const currentLineHeight = paragraphAttrs.lineHeight || '2.0';
  const currentTextColor = String(textStyleAttrs.color || '#000000').toLowerCase();
  const currentHeading = editor.isActive('heading')
    ? String(headingAttrs.level || 1)
    : 'paragraph';

  function setFontSize(value) {
    editor.chain().focus().setFontSize(value).run();
  }

  function insertPageBreak() {
    editor.chain().focus().insertContent({ type: 'pageBreak' }).run();
  }

  function applyHistoryAction(action) {
    return action === 'undo'
      ? editor.chain().focus().undo().run()
      : editor.chain().focus().redo().run();
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
        <DropdownSelect
          value={currentHeading}
          options={headingOptions}
          onChange={(value) => {
            const chain = editor.chain().focus();
            if (value === 'paragraph') chain.setParagraph().run();
            else chain.setHeading({ level: Number(value) }).run();
          }}
          ariaLabel="Paragraph or heading level"
          wrapperClassName="dropdown-select toolbar-select-wrapper toolbar-select-wrapper--wide"
          triggerClassName="sort-dropdown-trigger toolbar-select-trigger toolbar-select-trigger--wide"
          menuClassName="sort-dropdown-menu toolbar-select-menu toolbar-select-menu--wide"
        />
      </div>

      <div className="editor-toolbar-group">
        <DropdownSelect
          value={currentFontFamily}
          options={fontFamilyOptions}
          onChange={(value) => editor.chain().focus().setFontFamily(value).run()}
          ariaLabel="Font family"
          wrapperClassName="dropdown-select toolbar-select-wrapper toolbar-select-wrapper--wide"
          triggerClassName="sort-dropdown-trigger toolbar-select-trigger toolbar-select-trigger--wide"
          menuClassName="sort-dropdown-menu toolbar-select-menu toolbar-select-menu--wide"
        />
        <DropdownSelect
          value={currentFontSize}
          options={fontSizeOptions}
          onChange={setFontSize}
          ariaLabel="Font size"
          wrapperClassName="dropdown-select toolbar-select-wrapper toolbar-select-wrapper--compact"
          triggerClassName="sort-dropdown-trigger toolbar-select-trigger toolbar-select-trigger--compact"
          menuClassName="sort-dropdown-menu toolbar-select-menu toolbar-select-menu--compact"
        />
        <DropdownSelect
          value={currentLineHeight}
          options={lineHeightOptions}
          onChange={(value) => editor.chain().focus().updateAttributes('paragraph', { lineHeight: value }).run()}
          ariaLabel="Line spacing"
          wrapperClassName="dropdown-select toolbar-select-wrapper toolbar-select-wrapper--compact"
          triggerClassName="sort-dropdown-trigger toolbar-select-trigger toolbar-select-trigger--compact"
          menuClassName="sort-dropdown-menu toolbar-select-menu toolbar-select-menu--compact"
        />
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
        <label className="toolbar-color-picker" title="Choose a custom text color">
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(currentTextColor) ? currentTextColor : '#000000'}
            aria-label="Choose a custom text color"
            onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
          />
        </label>
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
        <ToolbarButton label="Justify text" icon={<ToolIcon type="justify" />} active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} />
        <ToolbarButton label="Bullet list" icon={<ToolIcon type="bullet" />} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton label="Ordered list" icon={<ToolIcon type="ordered" />} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarButton label="Block quote" icon={<ToolIcon type="quote" />} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      </div>

      <div className="editor-toolbar-group">
        <ToolbarButton label="Outdent" icon={<ToolIcon type="outdent" />} onClick={() => editor.chain().focus().updateAttributes('paragraph', { textIndent: '0in' }).run()} />
        <ToolbarButton label="Indent" icon={<ToolIcon type="indent" />} onClick={() => editor.chain().focus().updateAttributes('paragraph', { textIndent: '0.5in' }).run()} />
        <ToolbarButton label="Page break" icon={<ToolIcon type="break" />} onClick={insertPageBreak} />
        <ToolbarButton label="Undo" icon={<ToolIcon type="undo" />} disabled={!editor.can().undo()} onClick={() => applyHistoryAction('undo')} />
        <ToolbarButton label="Redo" icon={<ToolIcon type="redo" />} disabled={!editor.can().redo()} onClick={() => applyHistoryAction('redo')} />
      </div>
    </section>
  );
}
