import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EditMessageDto } from './dto/edit-message.dto';
import { SetReactionDto } from './dto/set-reaction.dto';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: string;
    username: string;
  };
};

@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly messagingGateway: MessagingGateway,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Patch(':messageId')
  async editMessage(
    @Req() request: AuthenticatedRequest,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    const message = await this.messagingService.editMessage(
      request.user.userId,
      messageId,
      dto.content,
    );
    this.messagingGateway.notifyMessageEdited(message);
    return message;
  }

  @UseGuards(JwtAuthGuard)
  @Put(':messageId/reaction')
  async setReaction(
    @Req() request: AuthenticatedRequest,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: SetReactionDto,
  ) {
    const change = await this.messagingService.setMessageReaction(
      request.user.userId,
      messageId,
      dto.reaction,
    );
    await this.messagingGateway.notifyMessageReactionsUpdated(change);
    return change.summary;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':messageId/reaction')
  async removeReaction(
    @Req() request: AuthenticatedRequest,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    const change = await this.messagingService.removeMessageReaction(
      request.user.userId,
      messageId,
    );
    await this.messagingGateway.notifyMessageReactionsUpdated(change);
    return change.summary;
  }
}
