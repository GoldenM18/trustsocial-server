import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { assertMessageStorageKey, MessageAttachmentStorage } from './message-attachment-storage';

@Injectable()
export class LocalMessageAttachmentStorage extends MessageAttachmentStorage {
  async save(body: Buffer, storageKey: string): Promise<void> {
    const filename = assertMessageStorageKey(storageKey);
    const directory = this.directory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), body, { flag: 'wx' });
  }

  async remove(storageKey: string): Promise<void> {
    let filename: string;
    try {
      filename = assertMessageStorageKey(storageKey);
    } catch {
      return;
    }

    try {
      await unlink(join(this.directory(), filename));
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }

  async open(storageKey: string): Promise<ReadStream | null> {
    const filename = assertMessageStorageKey(storageKey);
    const fullPath = join(this.directory(), filename);

    try {
      await stat(fullPath);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }

      throw error;
    }

    return createReadStream(fullPath);
  }

  private directory(): string {
    return join(process.cwd(), 'uploads', 'message-attachments');
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
