import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import { Server, Socket } from 'socket.io';

import { ALLOWED_MESSAGE_REACTIONS } from './dto/set-reaction.dto';
import { MessagingService, summarizeMessageReactions, type MessageReactionChange } from './messaging.service';

const MESSAGE_MAX_LENGTH = 5000;

type JwtPayload = {
  sub?: string;
};

type JoinConversationPayload = {
  conversationId?: unknown;
};

type SendMessagePayload = {
  conversationId?: unknown;
  content?: unknown;
  replyToMessageId?: unknown;
};

type EditMessagePayload = {
  messageId?: unknown;
  content?: unknown;
};

type ReactionPayload = {
  messageId?: unknown;
  reaction?: unknown;
};

type DeleteMessagePayload = {
  conversationId?: unknown;
  messageId?: unknown;
};

@WebSocketGateway({
  cors: { origin: true },
})
export class MessagingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly onlineSockets = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly messagingService: MessagingService,
  ) {}

  afterInit(server: Server) {
    server.use((socket, next) => {
      void this.authenticate(socket)
        .then((userId) => {
          socket.data.userId = userId;
          next();
        })
        .catch(() => {
          next(new Error('Unauthorized'));
        });
    });
  }

  handleConnection(client: Socket) {
    const userId = client.data.userId;

    if (typeof userId !== 'string' || userId.length === 0) {
      client.disconnect(true);
      return;
    }

    const existingSockets = this.onlineSockets.get(userId);
    const wasOffline = !existingSockets || existingSockets.size === 0;
    const sockets = existingSockets ?? new Set<string>();
    sockets.add(client.id);
    this.onlineSockets.set(userId, sockets);

    if (wasOffline) {
      this.server.emit('user_online', { userId });
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;

    if (typeof userId !== 'string' || userId.length === 0) {
      return;
    }

    const sockets = this.onlineSockets.get(userId);

    if (!sockets) {
      return;
    }

    sockets.delete(client.id);

    if (sockets.size === 0) {
      this.onlineSockets.delete(userId);
      this.server.emit('user_offline', { userId });
    }
  }

  @SubscribeMessage('join_conversation')
  async joinConversation(client: Socket, payload: JoinConversationPayload) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(payload?.conversationId);

    try {
      await this.messagingService.assertConversationAccess(userId, conversationId);
    } catch (error) {
      throw this.toSocketError(error, 'Unable to join conversation');
    }

    await client.join(conversationId);
    return { conversationId };
  }

  @SubscribeMessage('send_message')
  async sendMessage(client: Socket, payload: SendMessagePayload) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(payload?.conversationId);
    const content = this.optionalMessageContent(payload?.content);
    const replyToMessageId = this.optionalMessageId(payload?.replyToMessageId);

    try {
      const message = await this.messagingService.sendMessage(
        userId,
        conversationId,
        content,
        replyToMessageId,
      );
      await this.broadcastNewMessage(message);
      return message;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to send message');
    }
  }

  @SubscribeMessage('edit_message')
  async editMessage(client: Socket, payload: EditMessagePayload) {
    const userId = this.authenticatedUserId(client);
    const messageId = this.messageId(payload?.messageId);
    const content = this.messageContent(payload?.content);

    try {
      const message = await this.messagingService.editMessage(userId, messageId, content);
      this.notifyMessageEdited(message);
      return message;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to edit message');
    }
  }

  @SubscribeMessage('add_reaction')
  async addReaction(client: Socket, payload: ReactionPayload) {
    const userId = this.authenticatedUserId(client);
    const messageId = this.messageId(payload?.messageId);
    const reaction = this.reactionValue(payload?.reaction);

    try {
      const change = await this.messagingService.setMessageReaction(userId, messageId, reaction);
      await this.notifyMessageReactionsUpdated(change, client.id);
      return change.summary;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to add reaction');
    }
  }

  @SubscribeMessage('remove_reaction')
  async removeReaction(client: Socket, payload: ReactionPayload) {
    const userId = this.authenticatedUserId(client);
    const messageId = this.messageId(payload?.messageId);

    try {
      const change = await this.messagingService.removeMessageReaction(userId, messageId);
      await this.notifyMessageReactionsUpdated(change, client.id);
      return change.summary;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to remove reaction');
    }
  }

  @SubscribeMessage('delete_message_for_everyone')
  async deleteMessageForEveryone(client: Socket, payload: DeleteMessagePayload) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(payload?.conversationId);
    const messageId = this.messageId(payload?.messageId);

    try {
      const message = await this.messagingService.deleteMessageForEveryone(
        userId,
        conversationId,
        messageId,
      );
      this.notifyMessageDeletedForEveryone(message);
      return message;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to delete message');
    }
  }

  @SubscribeMessage('delete_message_for_me')
  async deleteMessageForMe(client: Socket, payload: DeleteMessagePayload) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(payload?.conversationId);
    const messageId = this.messageId(payload?.messageId);

    try {
      return await this.messagingService.deleteMessageForMe(userId, conversationId, messageId);
    } catch (error) {
      throw this.toSocketError(error, 'Unable to delete message');
    }
  }

  notifyMessageDeletedForEveryone(message: {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    createdAt: Date;
    deliveredAt: Date | null;
    readAt: Date | null;
    editedAt: Date | null;
    deletedForEveryone: boolean;
  }) {
    this.server.to(message.conversationId).emit('message_deleted_for_everyone', message);
  }

  private async broadcastNewMessage(message: {
    id: string;
    conversationId: string;
    senderId: string;
    replyTo: unknown;
  }) {
    if (!message.replyTo) {
      this.server.to(message.conversationId).emit('new_message', message);
      return;
    }

    const sockets = await this.server.in(message.conversationId).fetchSockets();

    await Promise.all(
      sockets.map(async (socket) => {
        const viewerId = socket.data.userId;

        if (typeof viewerId !== 'string' || viewerId.length === 0) {
          return;
        }

        if (viewerId.toLowerCase() === message.senderId.toLowerCase()) {
          socket.emit('new_message', message);
          return;
        }

        try {
          const payload = await this.messagingService.visibleMessageForViewer(message.id, viewerId);
          socket.emit('new_message', payload);
        } catch {
          return;
        }
      }),
    );
  }

  notifyMessageAttachmentAdded(message: {
    id: string;
    conversationId: string;
    attachments: unknown[];
  }) {
    this.server.to(message.conversationId).emit('message_attachment_added', message);
  }

  notifyMessageEdited(message: {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    createdAt: Date;
    deliveredAt: Date | null;
    readAt: Date | null;
    editedAt: Date | null;
    deletedForEveryone: boolean;
  }) {
    this.server.to(message.conversationId).emit('message_edited', message);
  }

  async notifyMessageReactionsUpdated(change: MessageReactionChange, exceptSocketId?: string) {
    const sockets = await this.server.in(change.conversationId).fetchSockets();

    for (const socket of sockets) {
      if (exceptSocketId && socket.id === exceptSocketId) {
        continue;
      }

      const userId = socket.data.userId;

      if (typeof userId !== 'string' || userId.length === 0) {
        continue;
      }

      socket.emit(
        'message_reactions_updated',
        summarizeMessageReactions(change.messageId, change.entries, userId),
      );
    }
  }

  @SubscribeMessage('typing_start')
  async typingStart(client: Socket, payload: JoinConversationPayload) {
    await this.broadcastTyping(client, payload, 'user_typing');
  }

  @SubscribeMessage('typing_stop')
  async typingStop(client: Socket, payload: JoinConversationPayload) {
    await this.broadcastTyping(client, payload, 'user_stopped_typing');
  }

  private async broadcastTyping(
    client: Socket,
    payload: JoinConversationPayload,
    event: 'user_typing' | 'user_stopped_typing',
  ) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(payload?.conversationId);

    try {
      await this.messagingService.assertConversationAccess(userId, conversationId);
    } catch (error) {
      throw this.toSocketError(error, 'Unable to update typing status');
    }

    client.to(conversationId).emit(event, { userId });
  }

  @SubscribeMessage('mark_as_delivered')
  async markAsDelivered(client: Socket, payload: JoinConversationPayload) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(payload?.conversationId);

    let messageIds: string[];

    try {
      const result = await this.messagingService.markConversationAsDelivered(
        conversationId,
        userId,
      );
      messageIds = result.messageIds;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to mark messages as delivered');
    }

    if (messageIds.length === 0) {
      return;
    }

    client.to(conversationId).emit('messages_delivered', {
      conversationId,
      messageIds,
      deliveredBy: userId,
    });
  }

  @SubscribeMessage('mark_as_read')
  async markAsRead(client: Socket, payload: JoinConversationPayload) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(payload?.conversationId);

    let messageIds: string[];

    try {
      const result = await this.messagingService.markConversationAsRead(conversationId, userId);
      messageIds = result.messageIds;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to mark messages as read');
    }

    if (messageIds.length === 0) {
      return;
    }

    client.to(conversationId).emit('messages_read', {
      conversationId,
      messageIds,
      readBy: userId,
    });
  }

  private async authenticate(socket: Socket): Promise<string> {
    const token = socket.handshake.auth?.token;

    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('Unauthorized');
    }

    const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('Unauthorized');
    }

    return payload.sub;
  }

  private authenticatedUserId(client: Socket): string {
    const userId = client.data.userId;

    if (typeof userId !== 'string' || userId.length === 0) {
      throw new WsException('Unauthorized');
    }

    return userId;
  }

  private conversationId(value: unknown): string {
    if (typeof value !== 'string' || !isUUID(value)) {
      throw new WsException('Invalid conversation id');
    }

    return value;
  }

  private messageId(value: unknown): string {
    if (typeof value !== 'string' || !isUUID(value)) {
      throw new WsException('Invalid message id');
    }

    return value;
  }

  private optionalMessageId(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (typeof value !== 'string' || !isUUID(value)) {
      throw new WsException('Invalid message id');
    }

    return value;
  }

  private reactionValue(value: unknown): string {
    if (typeof value !== 'string' || !ALLOWED_MESSAGE_REACTIONS.some((reaction) => reaction === value)) {
      throw new WsException('Reaction is not supported');
    }

    return value;
  }

  private optionalMessageContent(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value !== 'string') {
      throw new WsException('Message content is required');
    }

    const content = value.trim();

    if (content.length > MESSAGE_MAX_LENGTH) {
      throw new WsException('Message content must be at most 5000 characters');
    }

    return content;
  }

  private messageContent(value: unknown): string {
    if (typeof value !== 'string') {
      throw new WsException('Message content is required');
    }

    const content = value.trim();

    if (content.length === 0) {
      throw new WsException('Message content is required');
    }

    if (content.length > MESSAGE_MAX_LENGTH) {
      throw new WsException('Message content must be at most 5000 characters');
    }

    return content;
  }

  private toSocketError(error: unknown, fallback: string): WsException {
    if (error instanceof WsException) {
      return error;
    }

    if (error instanceof HttpException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof response === 'object' &&
              response !== null &&
              'message' in response &&
              typeof response.message === 'string'
            ? response.message
            : error.message;

      return new WsException(message);
    }

    return new WsException(fallback);
  }
}
