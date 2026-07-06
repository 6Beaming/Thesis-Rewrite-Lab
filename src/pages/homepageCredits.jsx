import trashUrl from '../assets/trash.png?url';

export default function HomepageCredits() {
  return (
    <section className="home-subpage credits-page">
      <header className="home-subpage-header">
        <div>
          <h1>Credits For</h1>
          <p>External resources currently used by the local UI.</p>
        </div>
      </header>
      <article className="credit-card">
        <img src={trashUrl} alt="" />
        <div>
          <strong>trash.png</strong>
          <p>Trash icon resource listed in the project plan.</p>
        </div>
      </article>
      <article className="credit-card">
        <div className="credit-placeholder">JSON</div>
        <div>
          <strong>streak_lottie.json</strong>
          <p>Noto emoji animation resource listed in the project plan.</p>
        </div>
      </article>
    </section>
  );
}
