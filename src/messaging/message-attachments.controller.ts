import { Controller, Get, Param, ParseUUIDPipe, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagingService } from './messaging.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: string;
    username: string;
  };
};

@Controller('message-attachments')
export class MessageAttachmentsController {
  constructor(private readonly messagingService: MessagingService) {}

  @UseGuards(JwtAuthGuard)
  @Get(':attachmentId')
  async open(
    @Req() request: AuthenticatedRequest,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    const image = await this.messagingService.openMessageImage(request.user.userId, attachmentId);

    return new StreamableFile(image.stream, {
      type: image.mimeType,
      disposition: 'inline',
      length: image.size,
    });
  }
}
