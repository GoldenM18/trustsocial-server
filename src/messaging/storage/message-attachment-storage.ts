import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';
import { ReadStream } from 'node:fs';

export const MESSAGE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const MESSAGE_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type MessageImageMimeType = (typeof MESSAGE_IMAGE_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<MessageImageMimeType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/i;

export type MessageImageUpload = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export function normalizeImageMime(mimetype: string): MessageImageMimeType | null {
  const normalized = mimetype.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimetype.toLowerCase();
  return MESSAGE_IMAGE_MIME_TYPES.find((allowed) => allowed === normalized) ?? null;
}

export function extensionForMessageImage(mimeType: MessageImageMimeType): string {
  return EXTENSION_BY_MIME[mimeType];
}

export function detectImageMime(buffer: Buffer): MessageImageMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (buffer.length >= 6) {
    const gif = buffer.subarray(0, 6).toString('ascii');
    if (gif === 'GIF87a' || gif === 'GIF89a') {
      return 'image/gif';
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

export function assertMessageStorageKey(storageKey: string): string {
  if (
    storageKey.includes('/') ||
    storageKey.includes('\\') ||
    storageKey.includes('..') ||
    !STORAGE_KEY_PATTERN.test(storageKey)
  ) {
    throw new BadRequestException('Invalid attachment');
  }

  return storageKey;
}

export const messageImageUploadOptions: MulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: MESSAGE_IMAGE_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_request, file, callback) => {
    if (!normalizeImageMime(file.mimetype)) {
      callback(new BadRequestException('Only JPEG, PNG, WebP, and GIF images are allowed'), false);
      return;
    }

    callback(null, true);
  },
};

/**
 * Stores one message image outside the database.
 * Replace this provider to move storage to S3 without changing the attachment API.
 */
export abstract class MessageAttachmentStorage {
  abstract save(body: Buffer, storageKey: string): Promise<void>;
  abstract remove(storageKey: string): Promise<void>;
  abstract open(storageKey: string): Promise<ReadStream | null>;
}
