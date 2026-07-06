import multer from 'multer';

const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.docx', '.png', '.jpg', '.jpeg', '.webp'];

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
  fileFilter(_req, file, callback) {
    const lowerName = file.originalname.toLowerCase();
    const acceptedExtension = ACCEPTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));

    if (!acceptedExtension) {
      callback(new Error('Only .txt, .md, and .docx uploads are supported.'));
      return;
    }

    callback(null, true);
  },
});
