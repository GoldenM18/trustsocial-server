import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { MessagingService } from './messaging.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: string;
    username: string;
  };
};

@Controller('conversations')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

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
    return this.messagingService.sendMessage(request.user.userId, conversationId, dto.content);
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
