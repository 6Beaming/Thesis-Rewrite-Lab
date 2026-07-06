import { forwardRef } from 'react';

const A4EditorPage = forwardRef(function A4EditorPage({
  children,
  pageCount = 1,
  pageNumberPosition = 'Bottom center',
  style,
}, ref) {
  const pages = Array.from({ length: Math.max(1, pageCount) }, (_item, index) => index + 1);
  const pageNumberClass = pageNumberPosition === 'Top right' ? ' is-page-number-top' : '';

  return (
    <section
      ref={ref}
      className={`a4-editor-page${pageNumberClass}`}
      aria-label={`${pages.length} A4 editor pages`}
      style={style}
    >
      {children}
      <div className="a4-page-markers" aria-hidden="true">
        {pages.map((pageNumber) => (
          <span
            key={pageNumber}
            className="a4-page-number"
            style={{ '--page-index': pageNumber - 1 }}
          >
            {pageNumber}
          </span>
        ))}
      </div>
      {pages.slice(1).map((pageNumber) => (
        <span
          key={`break-${pageNumber}`}
          className="a4-page-boundary"
          style={{ '--page-index': pageNumber - 1 }}
          aria-hidden="true"
        />
      ))}
    </section>
  );
});

export default A4EditorPage;
