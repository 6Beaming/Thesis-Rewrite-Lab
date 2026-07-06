import mountainUrl from '../assets/mountain.svg';
import ProgressRing from './ProgressRing.jsx';

export default function ProgressBanner({ value = 0 }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <section className="progress-banner" aria-label="Your progress">
      <ProgressRing value={percent} />
      <div className="progress-copy">
        <h2>Your progress</h2>
        <p>You have finished {percent}% of all practice!</p>
        <div className="progress-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
      <img className="progress-mountain-art" src={mountainUrl} alt="" />
    </section>
  );
}
