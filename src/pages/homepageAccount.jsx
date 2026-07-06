import lottie from 'lottie-web';
import { useEffect, useRef, useState } from 'react';
import owlUrl from '../assets/owl.svg';
import streakAnimation from '../assets/streak_lottie.json';

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M5 18.5h14" />
    </svg>
  );
}

export default function HomepageAccount({ user, onClose, onLogout, onUploadProfile }) {
  const inputRef = useRef(null);
  const streakRef = useRef(null);
  const [localPreview, setLocalPreview] = useState('');
  const streakDays = Math.max(1, Number(user?.stats?.streak_day_count ?? 1));
  const avatarSrc = localPreview || user?.profilePictureUrl || (user?.hasProfilePicture ? '/api/users/me/profile-picture' : owlUrl);
  const hasCustomAvatar = Boolean(localPreview || user?.profilePictureUrl || user?.hasProfilePicture);

  useEffect(() => {
    if (!streakRef.current) return undefined;

    const animation = lottie.loadAnimation({
      container: streakRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: streakAnimation,
    });

    return () => {
      animation.destroy();
    };
  }, []);

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLocalPreview(URL.createObjectURL(file));
    onUploadProfile?.(file);
    event.target.value = '';
  }

  return (
    <div className="account-overlay" role="presentation" onPointerDown={onClose}>
      <aside
        className="account-panel"
        aria-label="Account panel"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={`account-profile${hasCustomAvatar ? '' : ' is-default-owl'}`}>
          <span className={`account-profile-avatar${hasCustomAvatar ? '' : ' account-profile-avatar--owl'}`} aria-hidden={!hasCustomAvatar}>
            <img
              src={avatarSrc}
              alt=""
              referrerPolicy="no-referrer"
            />
          </span>
          <button
            type="button"
            className="home-upload account-upload-avatar"
            onClick={() => inputRef.current?.click()}
          >
            <UploadIcon />
            Upload Your Avatar
          </button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
        </div>
        <h2>{user?.email || user?.display_name || 'Your account'}</h2>
        <section className="account-streak">
          <div ref={streakRef} className="account-streak-lottie" aria-hidden="true" />
          <span className="account-streak-spark account-streak-spark--one" aria-hidden="true" />
          <span className="account-streak-spark account-streak-spark--two" aria-hidden="true" />
          <div className="account-streak-copy">
            <strong>{streakDays}</strong>
            <span>day streak</span>
          </div>
        </section>
        <div className="account-settings">
          {['Profile settings', 'Writing preferences', 'Notifications'].map((item) => (
            <button type="button" key={item}>{item}</button>
          ))}
        </div>
        <button type="button" className="account-logout" onClick={onLogout}>Logout</button>
      </aside>
    </div>
  );
}
