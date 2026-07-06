import { query } from './db.js';

function normalizeSessionUser(sessionUser) {
  const email = String(sessionUser?.email ?? '').trim().toLowerCase();
  if (!email) {
    throw new Error('Authenticated session is missing an email address.');
  }

  const displayName = String(sessionUser?.name ?? '').trim() || email.split('@')[0] || 'Signed-in user';
  return { email, displayName };
}

export async function getOrCreateUserFromSession(sessionUser) {
  const { email, displayName } = normalizeSessionUser(sessionUser);
  const result = await query(
    `
      insert into users (email, display_name)
      values ($1, $2)
      on conflict (email)
      do update set
        display_name = coalesce(excluded.display_name, users.display_name),
        updated_at = now()
      returning id, email, display_name, profile_picture_mime, created_at, updated_at
    `,
    [email, displayName]
  );

  const user = result.rows[0];
  await query(
    `
      insert into user_stats (user_id)
      values ($1)
      on conflict (user_id) do nothing
    `,
    [user.id]
  );

  return user;
}

export async function getCurrentUserProfile(sessionUser) {
  const user = await getOrCreateUserFromSession(sessionUser);
  const stats = await query(
    `
      select completed_chars, total_chars, completed_rate, streak_day_count,
             streak_start_date, streak_end_date, streak_days, updated_at
      from user_stats
      where user_id = $1
    `,
    [user.id]
  );

  return {
    ...user,
    hasProfilePicture: Boolean(user.profile_picture_mime),
    stats: stats.rows[0] ?? null,
  };
}

export async function updateProfilePicture({ userId, buffer, mimeType }) {
  const result = await query(
    `
      update users
      set profile_picture = $2,
          profile_picture_mime = $3
      where id = $1
      returning id, email, display_name, profile_picture_mime, updated_at
    `,
    [userId, buffer, mimeType]
  );
  return result.rows[0];
}

export async function getProfilePicture(userId) {
  const result = await query(
    `
      select profile_picture, profile_picture_mime
      from users
      where id = $1
    `,
    [userId]
  );
  return result.rows[0] ?? null;
}
