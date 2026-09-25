import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BadRequestException, Injectable } from '@nestjs/common';

import {
  extensionForImage,
  ProfilePhotoFile,
  ProfilePhotoStorage,
} from './profile-photo-storage';

@Injectable()
export class LocalProfilePhotoStorage extends ProfilePhotoStorage {
  async save(file: ProfilePhotoFile, publicBaseUrl: string): Promise<string> {
    const extension = extensionForImage(file.mimetype);

    if (!extension) {
      throw new BadRequestException('Only image files are allowed');
    }

    const filename = `${randomUUID()}${extension}`;
    const directory = join(process.cwd(), 'uploads', 'profile-photos');

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), file.buffer);

    const baseUrl = publicBaseUrl.replace(/\/$/, '');

    return `${baseUrl}/uploads/profile-photos/${filename}`;
  }
}
