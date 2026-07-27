import { useRef, useState } from 'react';
import owlUrl from '../assets/owl.svg';
import StreakAnimation from '../components/StreakAnimation.jsx';
import HomepageWritingPreferences from './HomepageWritingPreferences.jsx';

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M5 18.5h14" />
    </svg>
  );
}

export default function HomepageAccount({
  user,
  onClose,
  onLogout,
  onUploadProfile,
  onUpdateWritingPreferences,
}) {
  const inputRef = useRef(null);
  const [activeView, setActiveView] = useState('profile');
  const streakDays = Math.max(0, Number(user?.stats?.streak_day_count ?? 0));
  const avatarSrc = user?.profilePictureUrl || (user?.hasProfilePicture ? '/api/users/me/profile-picture' : owlUrl);
  const hasCustomAvatar = Boolean(user?.profilePictureUrl || user?.hasProfilePicture);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    await onUploadProfile?.(file);
    event.target.value = '';
  }

  return (
    <div className="account-overlay" role="presentation" onPointerDown={onClose}>
      <aside
        className={`account-panel${activeView === 'writing-preferences' ? ' account-panel--writing' : ''}`}
        aria-label="Account panel"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {activeView === 'writing-preferences' ? (
          <HomepageWritingPreferences
            user={user}
            onBack={() => setActiveView('profile')}
            onSave={onUpdateWritingPreferences}
          />
        ) : (
          <>
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
            Upload your avatar
          </button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
        </div>
        <h2>{user?.email || user?.display_name || 'Your account'}</h2>
        <section className="account-streak">
          <StreakAnimation className="account-streak-lottie" />
          <span className="account-streak-spark account-streak-spark--one" aria-hidden="true" />
          <span className="account-streak-spark account-streak-spark--two" aria-hidden="true" />
          <div className="account-streak-copy">
            <strong>{streakDays}</strong>
            <span>{streakDays === 1 ? 'Day streak' : 'Days streak'}</span>
          </div>
        </section>
        <div className="account-settings">
          <button type="button" style={{ textAlign: 'center' }} onClick={() => setActiveView('writing-preferences')}>
            Writing preferences
          </button>
        </div>
        <button type="button" className="account-logout" onClick={onLogout}>Log out</button>
          </>
        )}
      </aside>
    </div>
  );
}
