import multer from 'multer';

const DOCUMENT_EXTENSIONS = ['.txt', '.md', '.docx'];
const PROFILE_PICTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
export const MAX_DOCUMENT_UPLOAD_BYTES = Math.floor(2.5 * 1024 * 1024);
export const DOCUMENT_UPLOAD_SIZE_MESSAGE = 'Files must be 2.5 MB or smaller.';
export const DOCUMENT_UPLOAD_TYPE_MESSAGE =
  'File type is not supported. Please upload a .txt, .md, or .docx file.';

function unsupportedFileType(message) {
  const error = new Error(message);
  error.statusCode = 415;
  error.publicCode = 'UNSUPPORTED_FILE_TYPE';
  return error;
}

function createUpload(acceptedExtensions, message) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_DOCUMENT_UPLOAD_BYTES,
    },
    fileFilter(_req, file, callback) {
      const lowerName = file.originalname.toLowerCase();
      const acceptedExtension = acceptedExtensions.some(
        (extension) => lowerName.endsWith(extension),
      );

      if (!acceptedExtension) {
        callback(unsupportedFileType(message));
        return;
      }

      callback(null, true);
    },
  });
}

export const documentUpload = createUpload(
  DOCUMENT_EXTENSIONS,
  DOCUMENT_UPLOAD_TYPE_MESSAGE,
);

export const profilePictureUpload = createUpload(
  PROFILE_PICTURE_EXTENSIONS,
  'File type is not supported. Please upload a .png, .jpg, .jpeg, or .webp image.',
);
