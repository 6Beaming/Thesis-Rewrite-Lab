import { query } from './db.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeSessionUser(sessionUser) {
  const authUserId = String(sessionUser?.id ?? '').trim();
  if (!UUID_PATTERN.test(authUserId)) {
    throw new Error('Authenticated session is missing a valid user ID.');
  }

  const email = String(sessionUser?.email ?? '').trim().toLowerCase();
  if (!email) {
    throw new Error('Authenticated session is missing an email address.');
  }

  const displayName = String(sessionUser?.name ?? '').trim() || email.split('@')[0] || 'Signed-in user';
  return { authUserId, email, displayName };
}

export async function getOrCreateUserFromSession(sessionUser, runQuery = query) {
  const { authUserId, email, displayName } = normalizeSessionUser(sessionUser);
  const result = await runQuery(
    `
      insert into users (auth_user_id, email, display_name)
      values ($1, $2, $3)
      on conflict (auth_user_id)
      do update set
        email = excluded.email,
        display_name = coalesce(excluded.display_name, users.display_name),
        updated_at = now()
      returning id, auth_user_id, email, display_name, profile_picture_mime, created_at, updated_at
    `,
    [authUserId, email, displayName]
  );

  const user = result.rows[0];
  await runQuery(
    `
      insert into user_stats (user_id)
      values ($1)
      on conflict (user_id) do nothing
    `,
    [user.id]
  );

  return user;
}

export async function getCurrentUserProfile(sessionUser, runQuery = query) {
  const user = await getOrCreateUserFromSession(sessionUser, runQuery);
  const stats = await runQuery(
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

export async function getUserStats(userId, runQuery = query) {
  const result = await runQuery(
    `
      select completed_chars, total_chars, completed_rate, streak_day_count,
             streak_start_date, streak_end_date, streak_days, updated_at
      from user_stats
      where user_id = $1
    `,
    [userId],
  );
  return result.rows[0] ?? null;
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
