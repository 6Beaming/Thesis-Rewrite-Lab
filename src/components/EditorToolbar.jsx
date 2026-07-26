import ToolbarButton from './ToolbarButton.jsx';
import { useEffect, useState } from 'react';
import { DropdownSelect } from './SortDropdown.jsx';
import {
  currentProcessingTextAlign,
  focusEditorWithoutScroll,
  runToolbarCommand,
} from '../lib/editorFormattingCommands.js';
import { isolateSelectionInTransaction } from '../lib/editorBlockCommands.js';
import { EDITOR_PRESERVE_SCROLL_META } from '../lib/editorScrollGuard.js';

function ToolIcon({ type }) {
  const icons = {
    bold: <text x="5.4" y="19" fontSize="18.5" fontWeight="700" fill="currentColor" stroke="none">B</text>,
    italic: <text x="7.3" y="19" fontSize="18.5" fontStyle="italic" fontWeight="600" fill="currentColor" stroke="none">I</text>,
    underline: (
      <>
        <text x="6.7" y="16" fontSize="14.5" fill="currentColor" stroke="none">U</text>
        <path d="M5.5 19h13" />
      </>
    ),
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
  { value: 'none', label: 'None' },
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
    : paragraphAttrs.outlineLevel === 'paragraph' ? 'paragraph' : 'none';
  const currentTextAlign = currentProcessingTextAlign(editor);

  function setFontSize(value) {
    runToolbarCommand(editor, (chain) => chain.setFontSize(value));
  }

  function applyHistoryAction(action) {
    const chain = editor.chain().setMeta(EDITOR_PRESERVE_SCROLL_META, true);
    const applied = action === 'undo'
      ? chain.undo().run()
      : chain.redo().run();
    if (applied) focusEditorWithoutScroll(editor);
    return applied;
  }

  function applyStructuralCommand(command) {
    return runToolbarCommand(
      editor,
      (chain) => chain
        .command(({ state, tr }) => {
          isolateSelectionInTransaction(state, tr);
          return true;
        })[command](),
      { restoreSelection: false },
    );
  }

  return (
    <section className="editor-toolbar" aria-label="Document editing toolbar">
      <div className="editor-toolbar-group editor-toolbar-group--primary">
        <ToolbarButton
          label={saving ? 'Saving' : 'Save'}
          icon={<ToolIcon type="save" />}
          disabled={saveDisabled || saving}
          onClick={onSave}
        />
        <ToolbarButton label="Bold" icon={<ToolIcon type="bold" />} active={editor.isActive('bold')} onClick={() => runToolbarCommand(editor, (chain) => chain.toggleBold())} />
        <ToolbarButton label="Italic" icon={<ToolIcon type="italic" />} active={editor.isActive('italic')} onClick={() => runToolbarCommand(editor, (chain) => chain.toggleItalic())} />
        <ToolbarButton label="Underline" icon={<ToolIcon type="underline" />} active={editor.isActive('underline')} onClick={() => runToolbarCommand(editor, (chain) => chain.toggleUnderline())} />
        <ToolbarButton label="Undo" icon={<ToolIcon type="undo" />} disabled={!editor.can().undo()} onClick={() => applyHistoryAction('undo')} />
        <ToolbarButton label="Redo" icon={<ToolIcon type="redo" />} disabled={!editor.can().redo()} onClick={() => applyHistoryAction('redo')} />
        <ToolbarButton label="Block quote" icon={<ToolIcon type="quote" />} active={editor.isActive('blockquote')} onClick={() => applyStructuralCommand('toggleBlockquote')} />
      </div>

      <div className="editor-toolbar-group editor-toolbar-group--arrangement">
        <ToolbarButton label="Align left" icon={<ToolIcon type="left" />} active={currentTextAlign === 'left'} onClick={() => runToolbarCommand(editor, (chain) => chain.setTextAlign('left'))} />
        <ToolbarButton label="Align center" icon={<ToolIcon type="center" />} active={currentTextAlign === 'center'} onClick={() => runToolbarCommand(editor, (chain) => chain.setTextAlign('center'))} />
        <ToolbarButton label="Align right" icon={<ToolIcon type="right" />} active={currentTextAlign === 'right'} onClick={() => runToolbarCommand(editor, (chain) => chain.setTextAlign('right'))} />
        <ToolbarButton label="Justify text" icon={<ToolIcon type="justify" />} active={currentTextAlign === 'justify'} onClick={() => runToolbarCommand(editor, (chain) => chain.setTextAlign('justify'))} />
        <ToolbarButton label="Outdent" icon={<ToolIcon type="outdent" />} onClick={() => runToolbarCommand(editor, (chain) => chain.updateAttributes('paragraph', { textIndent: '0in' }))} />
        <ToolbarButton label="Indent" icon={<ToolIcon type="indent" />} onClick={() => runToolbarCommand(editor, (chain) => chain.updateAttributes('paragraph', { textIndent: '0.5in' }))} />
        <ToolbarButton label="Bullet list" icon={<ToolIcon type="bullet" />} active={editor.isActive('bulletList')} onClick={() => applyStructuralCommand('toggleBulletList')} />
        <ToolbarButton label="Ordered list" icon={<ToolIcon type="ordered" />} active={editor.isActive('orderedList')} onClick={() => applyStructuralCommand('toggleOrderedList')} />
      </div>

      <div className="editor-toolbar-group editor-toolbar-group--typography">
        <DropdownSelect
          value={currentHeading}
          options={headingOptions}
          onChange={(value) => {
            runToolbarCommand(editor, (chain) => {
              if (value === 'none') {
                return chain.setParagraph().updateAttributes('paragraph', { outlineLevel: 'none' });
              }
              if (value === 'paragraph') {
                return chain.setParagraph().updateAttributes('paragraph', { outlineLevel: 'paragraph' });
              }
              return chain.setHeading({ level: Number(value), outlineLevel: value });
            }, { restoreSelection: false });
          }}
          ariaLabel="Paragraph or heading level"
          wrapperClassName="dropdown-select toolbar-select-wrapper toolbar-select-wrapper--wide"
          triggerClassName="sort-dropdown-trigger toolbar-select-trigger toolbar-select-trigger--wide"
          menuClassName="sort-dropdown-menu toolbar-select-menu toolbar-select-menu--wide"
        />
        <DropdownSelect
          value={currentFontFamily}
          options={fontFamilyOptions}
          onChange={(value) => runToolbarCommand(editor, (chain) => chain.setFontFamily(value))}
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
          onChange={(value) => runToolbarCommand(editor, (chain) => chain.updateAttributes('paragraph', { lineHeight: value }))}
          ariaLabel="Line spacing"
          wrapperClassName="dropdown-select toolbar-select-wrapper toolbar-select-wrapper--compact"
          triggerClassName="sort-dropdown-trigger toolbar-select-trigger toolbar-select-trigger--compact"
          menuClassName="sort-dropdown-menu toolbar-select-menu toolbar-select-menu--compact"
        />
      </div>

      <div className="editor-toolbar-group editor-toolbar-group--colors editor-toolbar-swatches" aria-label="Text and highlight color controls">
        <div className="editor-toolbar-color-set" aria-label="Text color controls">
          {textColors.map((color) => (
            <button
              key={color}
              type="button"
              className="toolbar-swatch"
              style={{ '--swatch-color': color }}
              title={`Text color ${color}`}
              aria-label={`Text color ${color}`}
              onClick={() => runToolbarCommand(editor, (chain) => chain.setColor(color))}
            />
          ))}
          <label className="toolbar-color-picker" title="Choose a custom text color">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(currentTextColor) ? currentTextColor : '#000000'}
              aria-label="Choose a custom text color"
              onChange={(event) => runToolbarCommand(editor, (chain) => chain.setColor(event.target.value))}
            />
          </label>
        </div>
        <div className="editor-toolbar-color-set" aria-label="Highlight controls">
          {highlightColors.map((color) => (
            <button
              key={color}
              type="button"
              className="toolbar-swatch toolbar-swatch--highlight"
              style={{ '--swatch-color': color }}
              title={`Highlight ${color}`}
              aria-label={`Highlight ${color}`}
              onClick={() => runToolbarCommand(editor, (chain) => chain.toggleHighlight({ color }))}
            />
          ))}
          <button type="button" className="toolbar-swatch toolbar-swatch--clear" title="Clear highlight" aria-label="Clear highlight" onClick={() => runToolbarCommand(editor, (chain) => chain.unsetHighlight())}>
            /
          </button>
        </div>
      </div>
    </section>
  );
}
