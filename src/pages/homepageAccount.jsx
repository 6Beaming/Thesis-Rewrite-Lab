import { useRef, useState } from 'react';
import owlUrl from '../assets/owl.svg';

export default function HomepageAccount({ user, onClose, onLogout, onUploadProfile }) {
  const inputRef = useRef(null);
  const [localPreview, setLocalPreview] = useState('');
  const streakDays = Math.max(1, Number(user?.stats?.streak_day_count ?? 1));

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
        <div className="account-profile">
          <img
            src={localPreview || user?.image || (user?.hasProfilePicture ? '/api/users/me/profile-picture' : owlUrl)}
            alt=""
            referrerPolicy="no-referrer"
          />
          <button type="button" onClick={() => inputRef.current?.click()}>Upload Avatar</button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
        </div>
        <h2>{user?.email || user?.display_name || 'test@example.com'}</h2>
        <section className="account-streak">
          <span className="account-streak-spark account-streak-spark--one" aria-hidden="true" />
          <span className="account-streak-spark account-streak-spark--two" aria-hidden="true" />
          <strong>{streakDays}</strong>
          <span>day streak</span>
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
