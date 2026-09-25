import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/avif': '.avif',
};

export type ProfilePhotoFile = {
  buffer: Buffer;
  mimetype: string;
};

export function extensionForImage(mimetype: string): string | undefined {
  return IMAGE_EXTENSION_BY_MIME[mimetype.toLowerCase()];
}

export const profilePhotoUploadOptions: MulterOptions = {
  limits: {
    fileSize: PROFILE_PHOTO_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_request, file, callback) => {
    if (!extensionForImage(file.mimetype)) {
      callback(new BadRequestException('Only image files are allowed'), false);
      return;
    }

    callback(null, true);
  },
};

/**
 * Saves one profile image and returns its public URL.
 * Replace this provider to move storage to S3 without changing POST /users/me/photo.
 */
export abstract class ProfilePhotoStorage {
  abstract save(file: ProfilePhotoFile, publicBaseUrl: string): Promise<string>;
}
