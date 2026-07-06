import { requestJson } from './request.js';

export function getMe() {
  return requestJson('/users/me');
}

export function uploadProfilePicture(file) {
  const formData = new FormData();
  formData.append('file', file);
  return requestJson('/users/me/profile-picture', {
    method: 'POST',
    body: formData,
  });
}
