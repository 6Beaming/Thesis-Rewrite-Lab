import { useEffect, useState } from 'react';

export default function ProgressRing({ value = 0 }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const [displayValue, setDisplayValue] = useState(0);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - displayValue / 100);

  useEffect(() => {
    let frameId = 0;
    const duration = 900;
    const start = performance.now();

    function animate(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - ((1 - progress) ** 3);
      setDisplayValue(Math.round(clamped * eased));
      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      }
    }

    setDisplayValue(0);
    frameId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [clamped]);

  return (
    <div className="progress-ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="progress-ring-track" cx="60" cy="60" r={radius} />
        <circle
          className="progress-ring-fill"
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="progress-spark progress-spark--one" aria-hidden="true" />
      <span className="progress-spark progress-spark--two" aria-hidden="true" />
      <strong>{displayValue}%</strong>
      <small>Completed</small>
    </div>
  );
}
