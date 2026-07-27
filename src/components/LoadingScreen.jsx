export default function LoadingScreen({ overlay = false }) {
  return (
    <main
      className={`subscription-loading-screen app-loading-screen${overlay ? ' app-loading-screen--overlay' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="app-loading-spinner" aria-hidden="true" />
      <span>Loading...</span>
    </main>
  );
}
