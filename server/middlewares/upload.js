import multer from 'multer';

const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.docx', '.png', '.jpg', '.jpeg', '.webp'];
export const MAX_DOCUMENT_UPLOAD_BYTES = Math.floor(2.5 * 1024 * 1024);
export const DOCUMENT_UPLOAD_SIZE_MESSAGE = 'Files must be 2.5 MB or smaller.';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_UPLOAD_BYTES,
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
