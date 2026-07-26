import { requestJson } from './request.js';

export function getMe() {
  return requestJson('/users/me/activity', {
    method: 'POST',
    body: JSON.stringify({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }),
  });
}

export function uploadProfilePicture(file) {
  const formData = new FormData();
  formData.append('file', file);
  return requestJson('/users/me/profile-picture', {
    method: 'POST',
    body: formData,
  });
}

export function updateWritingPreferences(settings) {
  return requestJson('/users/me/writing-preferences', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}
