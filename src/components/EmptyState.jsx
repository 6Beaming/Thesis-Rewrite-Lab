export default function EmptyState({ title, children }) {
  return (
    <section className="home-empty-state">
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </section>
  );
}
