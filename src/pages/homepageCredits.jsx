import trashUrl from '../assets/trash.png?url';

export default function HomepageCredits() {
  return (
    <section className="home-subpage credits-page">
      <header className="home-subpage-header">
        <div>
          <h1><strong>Credits for</strong></h1>
          <p>External resources currently used by the local UI. <br /> <strong> Note: Others cool resources not listed here are manually made by the developers! </strong></p>
        </div>
      </header>
      <article className="credit-card">
        <img src={trashUrl} alt="" />
        <div>
          <strong>trash.png</strong>
          <p>Trash icon for the Trash subpage.</p>
        </div>
      </article>
      <article className="credit-card">
        <div className="credit-placeholder">JSON</div>
        <div>
          <strong>streak_lottie.json</strong>
          <p>Noto emoji animation for the streak accounts.</p>
        </div>
      </article>
    </section>
  );
}
