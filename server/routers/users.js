import { Router } from 'express';
import { upload } from '../middlewares/upload.js';
import {
  getCurrentUserProfile,
  getOrCreateUserFromSession,
  getProfilePicture,
  recordUserActivity,
  updateProfilePicture,
} from '../models/users.js';

const router = Router();

router.get('/me', async (_req, res) => {
  res.json(await getCurrentUserProfile(res.locals.session.user));
});

router.post('/me/activity', async (req, res) => {
  res.json(await recordUserActivity(
    res.locals.session.user,
    req.body?.timeZone,
  ));
});

router.get('/me/profile-picture', async (_req, res) => {
  const user = await getOrCreateUserFromSession(res.locals.session.user);
  const picture = await getProfilePicture(user.id);
  if (!picture?.profile_picture) {
    res.status(404).json({ error: 'Profile picture not found' });
    return;
  }
  res.type(picture.profile_picture_mime);
  res.send(picture.profile_picture);
});

router.post('/me/profile-picture', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Profile picture file is required' });
    return;
  }
  if (!req.file.mimetype.startsWith('image/')) {
    res.status(400).json({ error: 'Profile picture must be an image.' });
    return;
  }

  const user = await getOrCreateUserFromSession(res.locals.session.user);
  await updateProfilePicture({
    userId: user.id,
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
  });

  const profile = await getCurrentUserProfile(res.locals.session.user);
  const mutationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(req.get('x-mutation-id') ?? ''))
    ? req.get('x-mutation-id')
    : null;
  req.app.get('eventPublisher')?.publishProfile({
    authUserId: res.locals.session.user.id,
    profile,
    mutationId,
  });
  res.json(profile);
});

export default router;
