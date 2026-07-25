import { forwardRef } from 'react';

const A4EditorPage = forwardRef(function A4EditorPage({
  children,
  pageCount = 1,
  pageNumberPosition = 'Bottom center',
  style,
}, ref) {
  const pages = Math.max(1, pageCount);
  const pageNumberClass = pageNumberPosition === 'Top right'
    ? ' is-page-number-top'
    : pageNumberPosition === 'Bottom right'
      ? ' is-page-number-bottom-right'
      : ' is-page-number-bottom-center';
  const edgePageNumber = pageNumberPosition === 'Top right' ? 1 : pages;

  return (
    <section
      ref={ref}
      className={`a4-editor-page${pageNumberClass}`}
      aria-label={`${pages} A4 editor pages`}
      style={style}
    >
      {children}
      <span className="a4-page-edge-number" aria-hidden="true">{edgePageNumber}</span>
    </section>
  );
});

export default A4EditorPage;
