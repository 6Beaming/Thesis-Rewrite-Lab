import trashUrl from '../assets/trash.png?url';
import StreakAnimation from '../components/StreakAnimation.jsx';

export default function HomepageCredits() {
  return (
    <section className="home-subpage credits-page">
      <header className="home-subpage-header">
        <div>
          <h1><strong>Credits for</strong></h1>
          <p>External resources currently used by the local UI. <br /> <strong> Note: Others cool resources not listed here are manually made by the developers! </strong></p>
        </div>
      </header>
      <a
        className="credit-card"
        href="https://www.magnific.com/icon/delete_5175336#fromView=image_search&page=1&position=44&uuid=34406860-3ca7-4b23-a65e-0cd62460bb6c"
        target="_blank"
        rel="noopener noreferrer"
      >
        <img src={trashUrl} alt="" />
        <div>
          <strong>trash.png</strong>
          <p>Trash icon for the Trash subpage.</p>
        </div>
      </a>
      <a
        className="credit-card"
        href="https://googlefonts.github.io/noto-emoji-animation/?selected=Animated%20Emoji%3Aemoji_u1f525%3A"
        target="_blank"
        rel="noopener noreferrer"
      >
        <StreakAnimation className="credit-streak-animation" />
        <div>
          <strong>streak_lottie.json</strong>
          <p>Noto emoji animation for the streak accounts.</p>
        </div>
      </a>
    </section>
  );
}
