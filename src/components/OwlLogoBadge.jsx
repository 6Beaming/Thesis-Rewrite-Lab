import owlUrl from '../assets/owl.svg';

export default function OwlLogoBadge({ email = 'Your account', avatarSrc = '', onClick }) {
  const hasAvatar = Boolean(avatarSrc);

  return (
    <button type="button" className="home-user-badge" onClick={onClick} aria-label="Open account">
      <span className={`home-owl-logo${hasAvatar ? ' has-avatar' : ''}`} aria-hidden="true">
        <img src={avatarSrc || owlUrl} alt="" />
      </span>
      <span className="home-user-email">{email}</span>
    </button>
  );
}
