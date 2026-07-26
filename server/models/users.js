import { query, withTransaction } from './db.js';
import {
  normalizeWritingPreferences,
  WRITING_PREFERENCE_SCHEMA_VERSION,
} from '../../shared/writingPreferences.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateTimeZone(timeZone) {
  const candidate = String(timeZone ?? '').trim();
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format();
    return candidate;
  } catch {
    throw Object.assign(new Error('A valid IANA time zone is required.'), { status: 400 });
  }
}

export function localActivityDate(now, timeZone) {
  const zone = validateTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function nextStreakState(previousDate, previousCount, today) {
  if (!previousDate) return { count: 1, startDate: today };
  if (previousDate === today) return { count: Math.max(1, Number(previousCount) || 0), startDate: null };
  const distance = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`)) / 86_400_000,
  );
  return distance === 1
    ? { count: Math.max(1, Number(previousCount) || 0) + 1, startDate: null }
    : { count: 1, startDate: today };
}

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
      returning id, auth_user_id, email, display_name, profile_picture_mime,
                autosave_docs, use_writing_preferences, writing_preferences,
                preference_schema_version, created_at, updated_at
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

function profileFromUser(user, stats) {
  return {
    id: user.id,
    auth_user_id: user.auth_user_id,
    email: user.email,
    display_name: user.display_name,
    profile_picture_mime: user.profile_picture_mime,
    hasProfilePicture: Boolean(user.profile_picture_mime),
    autosaveDocs: Boolean(user.autosave_docs),
    useWritingPreferences: user.use_writing_preferences !== false,
    writingPreferences: normalizeWritingPreferences(
      user.writing_preferences,
      { strict: false },
    ),
    preferenceSchemaVersion: Number(user.preference_schema_version)
      || WRITING_PREFERENCE_SCHEMA_VERSION,
    created_at: user.created_at,
    updated_at: user.updated_at,
    stats: stats ?? null,
  };
}

export async function getCurrentUserProfile(sessionUser, runQuery = query) {
  const user = await getOrCreateUserFromSession(sessionUser, runQuery);
  const stats = await runQuery(
    `
      select completed_chars, total_chars, completed_rate, streak_day_count,
             streak_start_date, streak_end_date, streak_days, last_active_on,
             time_zone, updated_at
      from user_stats
      where user_id = $1
    `,
    [user.id]
  );

  return profileFromUser(user, stats.rows[0] ?? null);
}

export async function updateWritingPreferences({
  sessionUser,
  autosaveDocs,
  writingPreferences,
}, runQuery = query) {
  if (typeof autosaveDocs !== 'boolean') {
    throw Object.assign(new TypeError('autosaveDocs must be a boolean.'), { status: 400 });
  }
  const normalizedPreferences = normalizeWritingPreferences(writingPreferences);
  const user = await getOrCreateUserFromSession(sessionUser, runQuery);
  await runQuery(
    `
      update users
      set autosave_docs = $2,
          use_writing_preferences = true,
          writing_preferences = $3::jsonb,
          preference_schema_version = $4
      where id = $1
    `,
    [
      user.id,
      autosaveDocs,
      JSON.stringify(normalizedPreferences),
      WRITING_PREFERENCE_SCHEMA_VERSION,
    ],
  );
  return getCurrentUserProfile(sessionUser, runQuery);
}

export async function getUserStats(userId, runQuery = query) {
  const result = await runQuery(
    `
      select completed_chars, total_chars, completed_rate, streak_day_count,
             streak_start_date, streak_end_date, streak_days, last_active_on,
             time_zone, updated_at
      from user_stats
      where user_id = $1
    `,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function recordUserActivity(sessionUser, timeZone, now = new Date()) {
  const zone = validateTimeZone(timeZone);
  const today = localActivityDate(now, zone);
  return withTransaction(async (client) => {
    const runQuery = client.query.bind(client);
    const user = await getOrCreateUserFromSession(sessionUser, runQuery);
    const locked = await runQuery(
      `select streak_day_count, streak_start_date, last_active_on, streak_days
       from user_stats where user_id = $1 for update`,
      [user.id],
    );
    const previous = locked.rows[0] ?? {};
    const previousDate = previous.last_active_on
      ? new Date(previous.last_active_on).toISOString().slice(0, 10)
      : null;
    const next = nextStreakState(previousDate, previous.streak_day_count, today);
    const existingDays = Array.isArray(previous.streak_days) ? previous.streak_days : [];
    const streakDays = previousDate === today
      ? existingDays
      : [...existingDays.filter((date) => date !== today), today].slice(-366);
    await runQuery(
      `update user_stats
       set streak_day_count = $2,
           streak_start_date = case when $3::date is null then streak_start_date else $3::date end,
           streak_end_date = $4::date,
           streak_days = $5::jsonb,
           last_active_on = $4::date,
           time_zone = $6,
           updated_at = now()
       where user_id = $1`,
      [user.id, next.count, next.startDate, today, JSON.stringify(streakDays), zone],
    );
    const stats = await getUserStats(user.id, runQuery);
    const refreshedUser = await runQuery(
      `
        select id, auth_user_id, email, display_name, profile_picture_mime,
               autosave_docs, use_writing_preferences, writing_preferences,
               preference_schema_version, created_at, updated_at
        from users
        where id = $1
      `,
      [user.id],
    );
    return profileFromUser(refreshedUser.rows[0] ?? user, stats);
  });
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
