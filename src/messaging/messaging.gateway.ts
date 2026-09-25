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

import { MessagingService } from './messaging.service';

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
    const content = this.messageContent(payload?.content);

    try {
      const message = await this.messagingService.sendMessage(userId, conversationId, content);
      const payloadToEmit = {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        content: message.content,
        createdAt: message.createdAt,
      };

      this.server.to(conversationId).emit('new_message', payloadToEmit);
      return payloadToEmit;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to send message');
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
