import trashUrl from '../assets/trash.png?url';
import creditsForUrl from '../assets/credits_for.png?url';
import versionHistoryUrl from '../assets/version_history.png?url';
import StreakAnimation from '../components/StreakAnimation.jsx';

export default function HomepageCredits() {
  return (
    <section className="home-subpage credits-page">
      <header className="home-subpage-header home-subpage-header--illustrated">
        <div className="home-subpage-header-copy">
          <h1><strong>Credits for</strong></h1>
          <p>External resources currently used by the local UI. <br /> <strong> Note: Others cool resources not listed here are manually made by the developers! </strong></p>
        </div>
        <img className="home-subpage-header-art" src={creditsForUrl} alt="" />
      </header>
      <a
        className="credit-card"
        href="https://www.magnific.com/icon/task_735181#fromView=search&page=1&position=16&uuid=b4dbe2a9-e664-4c10-bc62-ef210fb91d38"
        target="_blank"
        rel="noopener noreferrer"
      >
        <img src={versionHistoryUrl} alt="" />
        <div>
          <strong>version_history.png</strong>
          <p>Version history icon for the Version History subpage.</p>
        </div>
      </a>
      <a
        className="credit-card"
        href="https://www.magnific.com/icon/care_7655704#fromView=search&page=1&position=37&uuid=f5c13695-9f01-4b03-8504-80b6beb633c9"
        target="_blank"
        rel="noopener noreferrer"
      >
        <img src={creditsForUrl} alt="" />
        <div>
          <strong>credits_for.png</strong>
          <p>Credits icon for the Credits subpage.</p>
        </div>
      </a>
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
