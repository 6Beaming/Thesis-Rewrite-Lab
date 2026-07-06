function ProfileAvatar({ user, size = 'size-11' }) {
  if (user.image) {
    return (
      <img
        src={user.image}
        alt=""
        referrerPolicy="no-referrer"
        className={`${size} rounded-full border border-slate-200 object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`grid ${size} place-items-center rounded-full bg-sky-100 font-semibold text-sky-800`}
    >
      {(user.name || user.email || '?').charAt(0).toUpperCase()}
    </span>
  );
}

export default ProfileAvatar;
