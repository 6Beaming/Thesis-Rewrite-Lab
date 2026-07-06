import owlUrl from '../assets/owl.svg';

export default function OwlLogoBadge({ email = 'test@example', onClick }) {
  return (
    <button type="button" className="home-user-badge" onClick={onClick} aria-label="Open account">
      <span className="home-owl-logo" aria-hidden="true">
        <img src={owlUrl} alt="" />
      </span>
      <span className="home-user-email">{email}</span>
    </button>
  );
}
