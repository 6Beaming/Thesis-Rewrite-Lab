import { Router } from 'express';
import { upload } from '../middlewares/upload.js';
import {
  getCurrentUserProfile,
  getOrCreateTestUser,
  getProfilePicture,
  updateProfilePicture,
} from '../models/users.js';

const router = Router();

router.get('/me', async (_req, res) => {
  res.json(await getCurrentUserProfile());
});

router.get('/me/profile-picture', async (_req, res) => {
  const user = await getOrCreateTestUser();
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

  const user = await getOrCreateTestUser();
  const updated = await updateProfilePicture({
    userId: user.id,
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
  });

  res.json(updated);
});

export default router;
