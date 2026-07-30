import ToolbarButton from './ToolbarButton.jsx';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { DropdownSelect } from './SortDropdown.jsx';
import {
  currentProcessingTextAlign,
  focusEditorWithoutScroll,
  runToolbarCommand,
} from '../lib/editorFormattingCommands.js';
import {
  isolateSelectionInTransaction,
  reapplyTrackedHeadingLevel,
  trackedParagraphAttributes,
  toggleBlockquoteInSelectedTextBlocks,
  updateTrackedBlocksInSelectedTextBlocks,
} from '../lib/editorBlockCommands.js';
import { EDITOR_PRESERVE_SCROLL_META } from '../lib/editorScrollGuard.js';

function ToolIcon({ type, accentColor }) {
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
    blockquote: <text x="4.2" y="19" fontSize="22" fontWeight="700" fill="currentColor" stroke="none">“</text>,
    left: <path d="M5 7h14M5 11h10M5 15h14M5 19h10" />,
    center: <path d="M5 7h14M7 11h10M5 15h14M7 19h10" />,
    right: <path d="M5 7h14M9 11h10M5 15h14M9 19h10" />,
    justify: <path d="M5 7h14M5 11h14M5 15h14M5 19h14" />,
    indent: <path d="M5 7h14M11 11h8M11 15h8M5 11l4 3-4 3" />,
    outdent: <path d="M5 7h14M11 11h8M11 15h8M9 11l-4 3 4 3" />,
    undo: <path d="M9 7H4v5M4 12c2-4 7-6 12-3 2 1 3 3 4 5" />,
    redo: <path d="M15 7h5v5M20 12c-2-4-7-6-12-3-2 1-3 3-4 5" />,
    save: <path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6" />,
    export: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />,
    eye: <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />,
    lineSpacing: <path d="M6 5v14M3.5 7.5 6 5l2.5 2.5M3.5 16.5 6 19l2.5-2.5M11 7h9M11 12h9M11 17h9" />,
    textColor: (
      <>
        <text x="6.1" y="17" fontSize="16.5" fontWeight="650" fill="currentColor" stroke="none">A</text>
        <path d="M5 20h14" style={{ stroke: accentColor || 'currentColor', strokeWidth: 3.2 }} />
      </>
    ),
    highlight: (
      <>
        <path d="m14.8 4 5.2 5.2-8.9 8.9-5.6.5.5-5.6zM13.2 5.6l5.2 5.2" />
        <path d="M4 21h16" style={{ stroke: accentColor || 'currentColor', strokeWidth: 2.8 }} />
      </>
    ),
    eyeOff: <path d="m4 4 16 16M10.6 10.8a2 2 0 0 0 2.6 2.6M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.4 9 7-.2 1.1-1 2.5-2.2 3.8M6.6 6.6C4.5 8 3.3 10.2 3 12c.5 2.6 4 7 9 7 1.4 0 2.7-.3 3.8-.9" />,
    plus: <path d="M12 5v14M5 12h14" />,
    eyedropper: <path d="m14.5 5.5 4-4 4 4-4 4M13 7l4 4-8.5 8.5-4.5.5.5-4.5zM4.5 19.5l-2 2" />,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {icons[type]}
    </svg>
  );
}

function OwlIcon() {
  return (
    <svg
      className="editor-owl-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="30" fill="#f6ead4" />
      <path d="M12 22 22 10l6 9h8l6-9 10 12v24c0 8-8 14-20 14S12 54 12 46Z" fill="#656560" />
      <circle cx="24" cy="32" r="10" fill="#fffdf4" />
      <circle cx="40" cy="32" r="10" fill="#fffdf4" />
      <circle cx="24" cy="32" r="4" fill="#162226" />
      <circle cx="40" cy="32" r="4" fill="#162226" />
      <path d="M32 37 26 34h12Z" fill="#f5a329" />
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
const colorPalette = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
];

const fontFamilyOptions = fontFamilies.map((font) => ({ value: font, label: font }));
const fontSizeOptions = fontSizes.map((size) => ({
  value: size,
  label: size.replace(/pt$/i, ''),
}));
const headingOptions = [
  { value: 'none', label: 'Normal text' },
  { value: '1', label: 'Heading 1' },
  { value: '2', label: 'Heading 2' },
  { value: '3', label: 'Heading 3' },
];
const alignmentOptions = [
  { value: 'left', label: 'Align left' },
  { value: 'center', label: 'Align center' },
  { value: 'right', label: 'Align right' },
  { value: 'justify', label: 'Justify text' },
];

function ToolbarMenu({
  label,
  icon,
  active = false,
  disabled = false,
  triggerClassName = '',
  menuClassName = '',
  children,
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(undefined);
  const menuRef = useRef(null);
  const floatingMenuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsideClick(event) {
      if (
        !menuRef.current?.contains(event.target)
        && !floatingMenuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      menuRef.current?.querySelector('.editor-toolbar-menu-trigger')?.focus();
    }

    document.addEventListener('click', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return undefined;

    const estimatedWidth = menuClassName.includes('--color')
      ? 300
      : menuClassName.includes('--alignment')
        ? 160
        : 128;

    function updateMenuPosition() {
      const rect = menuRef.current?.getBoundingClientRect();
      if (!rect) return;

      const viewportPadding = 8;
      const menuWidth = Math.min(estimatedWidth, window.innerWidth - (viewportPadding * 2));
      const centeredLeft = rect.left + (rect.width / 2) - (menuWidth / 2);
      const left = Math.max(
        viewportPadding,
        Math.min(centeredLeft, window.innerWidth - menuWidth - viewportPadding),
      );

      setMenuStyle({
        position: 'fixed',
        top: `${rect.bottom + 7}px`,
        right: 'auto',
        left: `${left}px`,
        transform: 'none',
      });
    }

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [menuClassName, open]);

  return (
    <div className={`editor-toolbar-menu-control${open ? ' is-open' : ''}`} ref={menuRef}>
      <button
        type="button"
        className={`editor-toolbar-button editor-toolbar-menu-trigger${triggerClassName ? ` ${triggerClassName}` : ''}${active ? ' is-active' : ''}`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
      </button>
      {open && !disabled && menuStyle
        ? createPortal(
          <div
            ref={floatingMenuRef}
            className={`editor-toolbar-menu ${menuClassName}`}
            role="menu"
            aria-label={label}
            style={menuStyle}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

function AlignmentMenu({ value, onChange }) {
  const currentAlignment = alignmentOptions.some((option) => option.value === value)
    ? value
    : 'left';
  const currentLabel = alignmentOptions.find((option) => option.value === currentAlignment)?.label;

  return (
    <ToolbarMenu
      label={`Text alignment: ${currentLabel}`}
      icon={(
        <span className="editor-alignment-trigger-content">
          <ToolIcon type={currentAlignment} />
          <span className="editor-toolbar-menu-caret" aria-hidden="true" />
        </span>
      )}
      triggerClassName="editor-alignment-trigger"
      menuClassName="editor-toolbar-menu--alignment"
    >
      {(closeMenu) => alignmentOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`editor-toolbar-button editor-alignment-option${currentAlignment === option.value ? ' is-selected' : ''}`}
          title={option.label}
          aria-label={option.label}
          role="menuitemradio"
          aria-checked={currentAlignment === option.value}
          onClick={() => {
            onChange(option.value);
            closeMenu();
          }}
        >
          <ToolIcon type={option.value} />
        </button>
      ))}
    </ToolbarMenu>
  );
}

function LineSpacingMenu({ value, onChange }) {
  return (
    <ToolbarMenu
      label="Line and paragraph spacing"
      icon={<ToolIcon type="lineSpacing" />}
      menuClassName="editor-toolbar-menu--spacing"
    >
      {(closeMenu) => lineHeights.map((height) => (
        <button
          key={height}
          type="button"
          className={`editor-spacing-option${height === value ? ' is-selected' : ''}`}
          role="menuitemradio"
          aria-checked={height === value}
          onClick={() => {
            onChange(height);
            closeMenu();
          }}
        >
          {height}
        </button>
      ))}
    </ToolbarMenu>
  );
}

function ColorPickerMenu({
  type,
  currentColor,
  onSelect,
  onClear,
}) {
  const customColorInputRef = useRef(null);
  const normalizedColor = String(currentColor || '').toLowerCase();
  const isHighlight = type === 'highlight';
  const label = isHighlight ? 'Highlight color' : 'Text color';
  const defaultCustomColor = /^#[0-9a-f]{6}$/i.test(normalizedColor)
    ? normalizedColor
    : isHighlight ? '#fff2cc' : '#000000';

  async function openEyedropper(closeMenu) {
    if (typeof window.EyeDropper !== 'function') {
      customColorInputRef.current?.click();
      return;
    }

    try {
      const result = await new window.EyeDropper().open();
      onSelect(result.sRGBHex);
      closeMenu();
    } catch {
      // Closing the eyedropper without choosing a color should leave formatting unchanged.
    }
  }

  function selectColor(color, closeMenu) {
    onSelect(color);
    closeMenu();
  }

  return (
    <ToolbarMenu
      label={label}
      active={isHighlight ? Boolean(normalizedColor) : normalizedColor !== '#000000'}
      icon={(
        <ToolIcon
          type={isHighlight ? 'highlight' : 'textColor'}
          accentColor={normalizedColor || (isHighlight ? '#fff2cc' : '#000000')}
        />
      )}
      menuClassName="editor-toolbar-menu--color"
    >
      {(closeMenu) => (
        <>
          {isHighlight ? (
            <button
              type="button"
              className={`editor-color-none${normalizedColor ? '' : ' is-selected'}`}
              role="menuitemradio"
              aria-checked={!normalizedColor}
              onClick={() => {
                onClear();
                closeMenu();
              }}
            >
              <ToolIcon type="eyeOff" />
              <span>None</span>
            </button>
          ) : null}

          <div className="editor-color-grid" role="group" aria-label={`${label} palette`}>
            {colorPalette.map((color) => (
              <button
                key={color}
                type="button"
                className={`editor-color-swatch${normalizedColor === color ? ' is-selected' : ''}`}
                style={{ '--swatch-color': color }}
                title={color}
                aria-label={`${label} ${color}`}
                role="menuitemradio"
                aria-checked={normalizedColor === color}
                onClick={() => selectColor(color, closeMenu)}
              />
            ))}
          </div>

          <div className="editor-color-custom-label">CUSTOM</div>
          <div className="editor-color-custom-row" role="group" aria-label={`Custom ${label.toLowerCase()}`}>
            {['#808080', '#000000'].map((color) => (
              <button
                key={color}
                type="button"
                className={`editor-color-swatch editor-color-custom-swatch${normalizedColor === color ? ' is-selected' : ''}`}
                style={{ '--swatch-color': color }}
                title={`${label} ${color}`}
                aria-label={`${label} ${color}`}
                role="menuitemradio"
                aria-checked={normalizedColor === color}
                onClick={() => selectColor(color, closeMenu)}
              />
            ))}
            <button
              type="button"
              className="editor-color-custom-action"
              title={`Choose custom ${label.toLowerCase()}`}
              aria-label={`Choose custom ${label.toLowerCase()}`}
              role="menuitem"
              onClick={() => customColorInputRef.current?.click()}
            >
              <ToolIcon type="plus" />
            </button>
            <button
              type="button"
              className="editor-color-custom-action"
              title={`Pick ${label.toLowerCase()} from the screen`}
              aria-label={`Pick ${label.toLowerCase()} from the screen`}
              role="menuitem"
              onClick={() => openEyedropper(closeMenu)}
            >
              <ToolIcon type="eyedropper" />
            </button>
            <input
              ref={customColorInputRef}
              className="editor-color-native-input"
              type="color"
              value={defaultCustomColor}
              tabIndex="-1"
              aria-hidden="true"
              onChange={(event) => selectColor(event.target.value, closeMenu)}
            />
          </div>
        </>
      )}
    </ToolbarMenu>
  );
}

export default function EditorToolbar({
  editor,
  normalTextStyle,
  blockVisualsVisible = true,
  onToggleBlockVisuals,
  pureMode = true,
  onTogglePureMode,
  onSave,
  onExport,
  saveDisabled = false,
  saving = false,
  exporting = false,
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
  const blockSegmentAttrs = editor.getAttributes('blockSegment');
  const textStyleAttrs = editor.getAttributes('textStyle');
  const currentFontFamily = textStyleAttrs.fontFamily || blockSegmentAttrs.fontFamily || paragraphAttrs.fontFamily || headingAttrs.fontFamily || 'Times New Roman';
  const currentFontSize = textStyleAttrs.fontSize || blockSegmentAttrs.fontSize || paragraphAttrs.fontSize || headingAttrs.fontSize || '12pt';
  const currentLineHeight = blockSegmentAttrs.lineHeight || paragraphAttrs.lineHeight || '2.0';
  const currentTextColor = String(textStyleAttrs.color || '#000000').toLowerCase();
  const highlightAttrs = editor.getAttributes('highlight');
  const currentHighlightColor = editor.isActive('highlight')
    ? String(highlightAttrs.color || '#fff2cc').toLowerCase()
    : '';
  const currentHeading = editor.isActive('heading')
    ? String(headingAttrs.level || 1)
    : 'none';
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

  const fileHistoryControls = (
    <>
      <ToolbarButton
        label={saving ? 'Saving' : 'Save'}
        icon={<ToolIcon type="save" />}
        disabled={saveDisabled || saving}
        onClick={onSave}
      />
      <ToolbarButton
        label={exporting ? 'Exporting' : 'Export'}
        icon={<ToolIcon type="export" />}
        disabled={saving || exporting}
        onClick={onExport}
      />
      <ToolbarButton label="Undo" icon={<ToolIcon type="undo" />} disabled={!editor.can().undo()} onClick={() => applyHistoryAction('undo')} />
      <ToolbarButton label="Redo" icon={<ToolIcon type="redo" />} disabled={!editor.can().redo()} onClick={() => applyHistoryAction('redo')} />
    </>
  );

  const typographyControls = (
    <>
      <DropdownSelect
        value={currentHeading}
        options={headingOptions}
        onChange={(value) => {
          runToolbarCommand(editor, (chain) => {
            if (value === 'none') {
              return chain
                .setParagraph({
                  outlineLevel: value,
                  lineHeight: normalTextStyle?.lineHeight,
                  textIndent: normalTextStyle?.textIndent,
                  fontFamily: normalTextStyle?.fontFamily,
                  fontSize: normalTextStyle?.fontSize,
                })
                .command(({ tr }) => {
                  const boldMark = tr.doc.type.schema.marks.bold;
                  updateTrackedBlocksInSelectedTextBlocks(
                    tr,
                    (attrs, { node, pos }) => {
                      if (
                        boldMark
                        && attrs.sourceType === 'heading'
                        && !attrs.headingRestoreAttrs
                      ) {
                        tr.removeMark(pos + 1, pos + node.nodeSize - 1, boldMark);
                      }
                      return trackedParagraphAttributes(attrs, normalTextStyle);
                    },
                  );
                  return true;
                });
            }
            const level = Number(value);
            return chain
              .setHeading({ level, outlineLevel: value })
              .command(({ tr }) => reapplyTrackedHeadingLevel(
                tr,
                level,
                normalTextStyle,
              ));
          }, { restoreSelection: false });
        }}
        ariaLabel="Paragraph or heading level"
        wrapperClassName="dropdown-select toolbar-select-wrapper toolbar-select-wrapper--style"
        triggerClassName="sort-dropdown-trigger toolbar-select-trigger toolbar-select-trigger--wide"
        menuClassName="sort-dropdown-menu toolbar-select-menu toolbar-select-menu--wide"
        fixedMenu
      />
      <DropdownSelect
        value={currentFontFamily}
        options={fontFamilyOptions}
        onChange={(value) => runToolbarCommand(editor, (chain) => chain.setFontFamily(value))}
        ariaLabel="Font family"
        wrapperClassName="dropdown-select toolbar-select-wrapper toolbar-select-wrapper--font"
        triggerClassName="sort-dropdown-trigger toolbar-select-trigger toolbar-select-trigger--wide"
        menuClassName="sort-dropdown-menu toolbar-select-menu toolbar-select-menu--wide"
        fixedMenu
      />
      <DropdownSelect
        value={currentFontSize}
        options={fontSizeOptions}
        onChange={setFontSize}
        ariaLabel="Font size"
        wrapperClassName="dropdown-select toolbar-select-wrapper toolbar-select-wrapper--size"
        triggerClassName="sort-dropdown-trigger toolbar-select-trigger toolbar-select-trigger--compact"
        menuClassName="sort-dropdown-menu toolbar-select-menu toolbar-select-menu--compact"
        fixedMenu
      />
    </>
  );

  const inlineControls = (
    <>
      <ToolbarButton label="Bold" icon={<ToolIcon type="bold" />} active={editor.isActive('bold')} onClick={() => runToolbarCommand(editor, (chain) => chain.toggleBold())} />
      <ToolbarButton label="Italic" icon={<ToolIcon type="italic" />} active={editor.isActive('italic')} onClick={() => runToolbarCommand(editor, (chain) => chain.toggleItalic())} />
      <ToolbarButton label="Underline" icon={<ToolIcon type="underline" />} active={editor.isActive('underline')} onClick={() => runToolbarCommand(editor, (chain) => chain.toggleUnderline())} />
      <ColorPickerMenu
        type="text"
        currentColor={currentTextColor}
        onSelect={(color) => runToolbarCommand(editor, (chain) => chain.setColor(color))}
      />
      <ColorPickerMenu
        type="highlight"
        currentColor={currentHighlightColor}
        onSelect={(color) => runToolbarCommand(editor, (chain) => chain.setHighlight({ color }))}
        onClear={() => runToolbarCommand(editor, (chain) => chain.unsetHighlight())}
      />
    </>
  );

  const paragraphControls = (
    <>
      <AlignmentMenu
        value={currentTextAlign}
        onChange={(value) => runToolbarCommand(editor, (chain) => chain.setTextAlign(value))}
      />
      <LineSpacingMenu
        value={currentLineHeight}
        onChange={(value) => runToolbarCommand(editor, (chain) => chain.updateAttributes('paragraph', { lineHeight: value }))}
      />
      <div className="editor-toolbar-subgroup" role="group" aria-label="Lists and block quote">
        <ToolbarButton label="Bullet list" icon={<ToolIcon type="bullet" />} active={editor.isActive('bulletList')} onClick={() => applyStructuralCommand('toggleBulletList')} />
        <ToolbarButton label="Ordered list" icon={<ToolIcon type="ordered" />} active={editor.isActive('orderedList')} onClick={() => applyStructuralCommand('toggleOrderedList')} />
        <ToolbarButton
          label="Block quote"
          icon={<ToolIcon type="blockquote" />}
          active={editor.isActive('blockquote')}
          onClick={() => runToolbarCommand(
            editor,
            (chain) => chain.command(
              ({ tr }) => toggleBlockquoteInSelectedTextBlocks(tr),
            ),
            { restoreSelection: false },
          )}
        />
      </div>
      <div className="editor-toolbar-subgroup" role="group" aria-label="Indentation">
        <ToolbarButton label="Decrease indent" icon={<ToolIcon type="outdent" />} onClick={() => runToolbarCommand(editor, (chain) => chain.updateAttributes('paragraph', { textIndent: '0in' }))} />
        <ToolbarButton label="Increase indent" icon={<ToolIcon type="indent" />} onClick={() => runToolbarCommand(editor, (chain) => chain.updateAttributes('paragraph', { textIndent: '0.5in' }))} />
      </div>
    </>
  );

  return (
    <section className="editor-toolbar" aria-label="Document editing toolbar">
      <div className="editor-toolbar-group editor-toolbar-group--block-visibility" role="group" aria-label="Workspace display">
        <button
          type="button"
          className={`editor-toolbar-button editor-block-visibility-toggle${blockVisualsVisible ? ' is-active' : ''}`}
          onClick={onToggleBlockVisuals}
          title={blockVisualsVisible ? 'Hide block highlights and borders' : 'Show block highlights and borders'}
          aria-label={blockVisualsVisible ? 'Hide block highlights and borders' : 'Show block highlights and borders'}
          aria-pressed={blockVisualsVisible}
        >
          <ToolIcon type={blockVisualsVisible ? 'eye' : 'eyeOff'} />
          <span className="editor-block-visibility-toggle__label">Blocks</span>
          <span className="editor-block-visibility-toggle__state" aria-hidden="true">
            {blockVisualsVisible ? 'On' : 'Off'}
          </span>
        </button>
        <button
          type="button"
          className={`editor-toolbar-button editor-block-visibility-toggle editor-pure-mode-toggle${pureMode ? ' is-active' : ''}`}
          onClick={onTogglePureMode}
          title={pureMode ? 'Turn Owl off' : 'Turn Owl on'}
          aria-label={pureMode ? 'Turn Owl off' : 'Turn Owl on'}
          aria-pressed={pureMode}
        >
          <OwlIcon />
          <span className="editor-block-visibility-toggle__state" aria-hidden="true">
            {pureMode ? 'On' : 'Off'}
          </span>
        </button>
      </div>

      <div className="editor-toolbar-group editor-toolbar-group--file-history" role="group" aria-label="File and history">
        {fileHistoryControls}
      </div>

      <div className="editor-toolbar-group editor-toolbar-group--typography" role="group" aria-label="Typography">
        {typographyControls}
      </div>

      <div className="editor-toolbar-group editor-toolbar-group--inline" role="group" aria-label="Inline formatting">
        {inlineControls}
      </div>

      <div className="editor-toolbar-group editor-toolbar-group--paragraph" role="group" aria-label="Paragraph and lists">
        {paragraphControls}
      </div>
    </section>
  );
}
