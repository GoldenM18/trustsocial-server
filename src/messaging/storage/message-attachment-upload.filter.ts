import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

@Catch(MulterError)
export class MessageAttachmentUploadFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({
        statusCode: 413,
        message: 'Image must be at most 5 MB',
      });
      return;
    }

    response.status(400).json({
      statusCode: 400,
      message: 'Could not upload image',
    });
  }
}
