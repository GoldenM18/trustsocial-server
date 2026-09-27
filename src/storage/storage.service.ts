import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

@Injectable()
export class StorageService {
  private s3: S3Client | null = null;

  private getClient(): S3Client {
    if (this.s3) {
      return this.s3;
    }

    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!region || !accessKeyId || !secretAccessKey) {
      throw new InternalServerErrorException(
        'AWS storage is not configured yet',
      );
    }

    this.s3 = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    return this.s3;
  }

  async uploadPostImage(
    file: Express.Multer.File,
  ): Promise<string> {
    const bucket = process.env.AWS_S3_BUCKET;

    /*
     * Local development fallback.
     * AWS can be enabled later without changing the mobile app.
     */
    if (
      !process.env.AWS_REGION ||
      !process.env.AWS_ACCESS_KEY_ID ||
      !process.env.AWS_SECRET_ACCESS_KEY ||
      !bucket
    ) {
      return this.saveLocally(file);
    }

    const extension =
      file.originalname.split('.').pop()?.toLowerCase() || 'jpg';

    const key = `posts/${randomUUID()}.${extension}`;

    try {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );

      return `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    } catch (error) {
      console.error('S3 upload failed:', error);

      throw new InternalServerErrorException(
        'Could not upload image',
      );
    }
  }

  private saveLocally(
    file: Express.Multer.File,
  ): string {
    const uploadDirectory = join(
      process.cwd(),
      'uploads',
      'post-images',
    );

    if (!existsSync(uploadDirectory)) {
      mkdirSync(uploadDirectory, {
        recursive: true,
      });
    }

    const extension =
      file.originalname.split('.').pop()?.toLowerCase() || 'jpg';

    const filename = `${randomUUID()}.${extension}`;

    const filePath = join(uploadDirectory, filename);

    try {
      writeFileSync(filePath, file.buffer);

      const port = process.env.PORT ?? 3000;

      return `http://192.168.0.105:${port}/uploads/post-images/${filename}`;
    } catch (error) {
      console.error('Local image save failed:', error);

      throw new InternalServerErrorException(
        'Could not save image',
      );
    }
  }
}
