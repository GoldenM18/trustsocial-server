import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { SearchMessagesDto } from './dto/search-messages.dto';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';
import { MessageAttachmentUploadFilter } from './storage/message-attachment-upload.filter';
import {
  type MessageImageUpload,
  messageImageUploadOptions,
} from './storage/message-attachment-storage';

type AuthenticatedRequest = Request & {
  user: {
    userId: string;
    username: string;
  };
};

@Controller('conversations')
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly messagingGateway: MessagingGateway,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.messagingService.list(request.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateConversationDto) {
    return this.messagingService.findOrCreate(request.user.userId, dto.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':conversationId/messages')
  sendMessage(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messagingService.sendMessage(
      request.user.userId,
      conversationId,
      dto.content,
      dto.replyToMessageId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':conversationId/messages/:messageId/attachments')
  @UseFilters(MessageAttachmentUploadFilter)
  @UseInterceptors(FileInterceptor('file', messageImageUploadOptions))
  async addAttachment(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @UploadedFile() file?: MessageImageUpload,
  ) {
    if (!file) {
      throw new BadRequestException('An image file is required');
    }

    const host = request.get('host');
    const publicBaseUrl = host
      ? `${request.protocol}://${host}`
      : `http://localhost:${process.env.PORT ?? 3000}`;
    const result = await this.messagingService.addMessageImage(
      request.user.userId,
      conversationId,
      messageId,
      file,
      publicBaseUrl,
    );
    this.messagingGateway.notifyMessageAttachmentAdded(result.message);
    return result.attachment;
  }

  @UseGuards(JwtAuthGuard)
  @Post(':conversationId/messages/:messageId/delete-for-everyone')
  async deleteMessageForEveryone(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    const message = await this.messagingService.deleteMessageForEveryone(
      request.user.userId,
      conversationId,
      messageId,
    );
    this.messagingGateway.notifyMessageDeletedForEveryone(message);
    return message;
  }

  @UseGuards(JwtAuthGuard)
  @Post(':conversationId/messages/:messageId/delete-for-me')
  deleteMessageForMe(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.messagingService.deleteMessageForMe(
      request.user.userId,
      conversationId,
      messageId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':conversationId/messages/search')
  searchMessages(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: SearchMessagesDto,
  ) {
    return this.messagingService.searchMessages(request.user.userId, conversationId, query);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':conversationId/messages')
  listMessages(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.messagingService.listMessages(request.user.userId, conversationId, query);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':conversationId/read')
  markConversationAsRead(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagingService.markConversationAsRead(conversationId, request.user.userId);
  }
}
