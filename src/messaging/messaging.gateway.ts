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

import { NotificationDelivery } from '../notifications/notification-delivery';
import {
  CallMediaDelivery,
  CallNotice,
  CallSignalingService,
  readIceCandidate,
  readSessionDescription,
} from './call-signaling.service';
import { ALLOWED_MESSAGE_REACTIONS } from './dto/set-reaction.dto';
import {
  MessagingService,
  summarizeMessageReactions,
  type MessageReactionChange,
} from './messaging.service';

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

type CallInvitePayload = {
  conversationId?: unknown;
};

type CallIdPayload = {
  callId?: unknown;
};

type CallDescriptionPayload = {
  callId?: unknown;
  sdp?: unknown;
};

type CallIcePayload = {
  callId?: unknown;
  candidate?: unknown;
};

@WebSocketGateway({
  cors: { origin: true },
})
export class MessagingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly onlineSockets = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly messagingService: MessagingService,
    private readonly notificationDelivery: NotificationDelivery,
    private readonly callSignaling: CallSignalingService,
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

    this.notificationDelivery.register((recipientId, notification) => {
      const socketIds = this.onlineSockets.get(recipientId);

      if (!socketIds) {
        return;
      }

      for (const socketId of socketIds) {
        this.server.to(socketId).emit('notification:new', notification);
      }
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

  async handleDisconnect(client: Socket) {
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

    try {
      const ended = await this.callSignaling.disconnectSocket(
        userId,
        client.id,
        this.onlineSockets.has(userId),
      );

      if (ended) {
        this.deliverCallNotices(ended);
        this.notifyCallHistoryChanged(ended);
      }
    } catch {
      // A socket disconnect should never crash the gateway.
    }
  }

  @SubscribeMessage('join_conversation')
  async joinConversation(
    client: Socket,
    payload: JoinConversationPayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(payload?.conversationId);

    try {
      await this.messagingService.assertConversationAccess(
        userId,
        conversationId,
      );
    } catch (error) {
      throw this.toSocketError(error, 'Unable to join conversation');
    }

    await client.join(conversationId);

    return { conversationId };
  }

  @SubscribeMessage('send_message')
  async sendMessage(
    client: Socket,
    payload: SendMessagePayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(
      payload?.conversationId,
    );
    const content = this.optionalMessageContent(payload?.content);
    const replyToMessageId = this.optionalMessageId(
      payload?.replyToMessageId,
    );

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
  async editMessage(
    client: Socket,
    payload: EditMessagePayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const messageId = this.messageId(payload?.messageId);
    const content = this.messageContent(payload?.content);

    try {
      const message = await this.messagingService.editMessage(
        userId,
        messageId,
        content,
      );

      this.notifyMessageEdited(message);

      return message;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to edit message');
    }
  }

  @SubscribeMessage('add_reaction')
  async addReaction(
    client: Socket,
    payload: ReactionPayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const messageId = this.messageId(payload?.messageId);
    const reaction = this.reactionValue(payload?.reaction);

    try {
      const change =
        await this.messagingService.setMessageReaction(
          userId,
          messageId,
          reaction,
        );

      await this.notifyMessageReactionsUpdated(
        change,
        client.id,
      );

      return change.summary;
    } catch (error) {
      throw this.toSocketError(error, 'Unable to add reaction');
    }
  }

  @SubscribeMessage('remove_reaction')
  async removeReaction(
    client: Socket,
    payload: ReactionPayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const messageId = this.messageId(payload?.messageId);

    try {
      const change =
        await this.messagingService.removeMessageReaction(
          userId,
          messageId,
        );

      await this.notifyMessageReactionsUpdated(
        change,
        client.id,
      );

      return change.summary;
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to remove reaction',
      );
    }
  }

  @SubscribeMessage('delete_message_for_everyone')
  async deleteMessageForEveryone(
    client: Socket,
    payload: DeleteMessagePayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(
      payload?.conversationId,
    );
    const messageId = this.messageId(payload?.messageId);

    try {
      const message =
        await this.messagingService.deleteMessageForEveryone(
          userId,
          conversationId,
          messageId,
        );

      this.notifyMessageDeletedForEveryone(message);

      return message;
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to delete message',
      );
    }
  }

  @SubscribeMessage('delete_message_for_me')
  async deleteMessageForMe(
    client: Socket,
    payload: DeleteMessagePayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(
      payload?.conversationId,
    );
    const messageId = this.messageId(payload?.messageId);

    try {
      return await this.messagingService.deleteMessageForMe(
        userId,
        conversationId,
        messageId,
      );
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to delete message',
      );
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
    this.server
      .to(message.conversationId)
      .emit('message_deleted_for_everyone', message);
  }

  private async broadcastNewMessage(message: {
    id: string;
    conversationId: string;
    senderId: string;
    replyTo: unknown;
  }) {
    if (!message.replyTo) {
      this.server
        .to(message.conversationId)
        .emit('new_message', message);

      return;
    }

    const sockets = await this.server
      .in(message.conversationId)
      .fetchSockets();

    await Promise.all(
      sockets.map(async (socket) => {
        const viewerId = socket.data.userId;

        if (
          typeof viewerId !== 'string' ||
          viewerId.length === 0
        ) {
          return;
        }

        if (
          viewerId.toLowerCase() ===
          message.senderId.toLowerCase()
        ) {
          socket.emit('new_message', message);
          return;
        }

        try {
          const payload =
            await this.messagingService.visibleMessageForViewer(
              message.id,
              viewerId,
            );

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
    this.server
      .to(message.conversationId)
      .emit('message_attachment_added', message);
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
    this.server
      .to(message.conversationId)
      .emit('message_edited', message);
  }

  async notifyMessageReactionsUpdated(
    change: MessageReactionChange,
    exceptSocketId?: string,
  ) {
    const sockets = await this.server
      .in(change.conversationId)
      .fetchSockets();

    for (const socket of sockets) {
      if (
        exceptSocketId &&
        socket.id === exceptSocketId
      ) {
        continue;
      }

      const userId = socket.data.userId;

      if (
        typeof userId !== 'string' ||
        userId.length === 0
      ) {
        continue;
      }

      socket.emit(
        'message_reactions_updated',
        summarizeMessageReactions(
          change.messageId,
          change.entries,
          userId,
        ),
      );
    }
  }

  @SubscribeMessage('typing_start')
  async typingStart(
    client: Socket,
    payload: JoinConversationPayload,
  ) {
    await this.broadcastTyping(
      client,
      payload,
      'user_typing',
    );
  }

  @SubscribeMessage('typing_stop')
  async typingStop(
    client: Socket,
    payload: JoinConversationPayload,
  ) {
    await this.broadcastTyping(
      client,
      payload,
      'user_stopped_typing',
    );
  }

  private async broadcastTyping(
    client: Socket,
    payload: JoinConversationPayload,
    event:
      | 'user_typing'
      | 'user_stopped_typing',
  ) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(
      payload?.conversationId,
    );

    try {
      await this.messagingService.assertConversationAccess(
        userId,
        conversationId,
      );
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to update typing status',
      );
    }

    client
      .to(conversationId)
      .emit(event, { userId });
  }

  @SubscribeMessage('mark_as_delivered')
  async markAsDelivered(
    client: Socket,
    payload: JoinConversationPayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(
      payload?.conversationId,
    );

    let messageIds: string[];

    try {
      const result =
        await this.messagingService.markConversationAsDelivered(
          conversationId,
          userId,
        );

      messageIds = result.messageIds;
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to mark messages as delivered',
      );
    }

    if (messageIds.length === 0) {
      return;
    }

    client
      .to(conversationId)
      .emit('messages_delivered', {
        conversationId,
        messageIds,
        deliveredBy: userId,
      });
  }

  @SubscribeMessage('mark_as_read')
  async markAsRead(
    client: Socket,
    payload: JoinConversationPayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(
      payload?.conversationId,
    );

    let messageIds: string[];

    try {
      const result =
        await this.messagingService.markConversationAsRead(
          conversationId,
          userId,
        );

      messageIds = result.messageIds;
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to mark messages as read',
      );
    }

    if (messageIds.length === 0) {
      return;
    }

    client
      .to(conversationId)
      .emit('messages_read', {
        conversationId,
        messageIds,
        readBy: userId,
      });
  }

  @SubscribeMessage('call:invite')
  async inviteCall(
    client: Socket,
    payload: CallInvitePayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.conversationId(
      payload?.conversationId,
    );

    try {
      const invited =
        await this.callSignaling.invite(
          userId,
          client.id,
          conversationId,
        );

      const recipientSockets =
        this.socketIdsForUser(invited.recipientId);

      if (recipientSockets.length === 0) {
        this.callSignaling.abandonUndelivered(
          invited.callId,
        );

        throw new WsException(
          'User is not available for a call',
        );
      }

      this.deliverCallNotices([
        this.callSignaling.incomingNotice(invited),
      ]);

      return {
        callId: invited.callId,
        conversationId: invited.conversationId,
      };
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to start call',
      );
    }
  }

  @SubscribeMessage('call:accept')
  acceptCall(
    client: Socket,
    payload: CallIdPayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const callId = this.callId(payload?.callId);

    try {
      const notices = this.callSignaling.accept(
        userId,
        client.id,
        callId,
      );

      this.deliverCallNotices(notices);

      return { callId };
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to accept call',
      );
    }
  }

  @SubscribeMessage('call:reject')
  async rejectCall(
    client: Socket,
    payload: CallIdPayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const callId = this.callId(payload?.callId);

    try {
      const notices =
        await this.callSignaling.reject(
          userId,
          client.id,
          callId,
        );

      this.deliverCallNotices(notices);
      this.notifyCallHistoryChanged(notices);

      return { callId };
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to reject call',
      );
    }
  }

  @SubscribeMessage('call:end')
  async endCall(
    client: Socket,
    payload: CallIdPayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const callId = this.callId(payload?.callId);

    try {
      const notices =
        await this.callSignaling.end(
          userId,
          client.id,
          callId,
        );

      this.deliverCallNotices(notices);
      this.notifyCallHistoryChanged(notices);

      return { callId };
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to end call',
      );
    }
  }

  @SubscribeMessage('call:offer')
  relayCallOffer(
    client: Socket,
    payload: CallDescriptionPayload,
  ) {
    return this.relayCallMedia(
      client,
      payload,
      'offer',
    );
  }

  @SubscribeMessage('call:answer')
  relayCallAnswer(
    client: Socket,
    payload: CallDescriptionPayload,
  ) {
    return this.relayCallMedia(
      client,
      payload,
      'answer',
    );
  }

  @SubscribeMessage('call:ice-candidate')
  relayIceCandidate(
    client: Socket,
    payload: CallIcePayload,
  ) {
    const userId = this.authenticatedUserId(client);
    const callId = this.callId(payload?.callId);
    const candidate = readIceCandidate(
      payload?.candidate,
    );

    try {
      const delivery =
        this.callSignaling.iceCandidate(
          userId,
          client.id,
          callId,
          candidate,
        );

      this.deliverCallMedia(delivery);

      return { callId };
    } catch (error) {
      throw this.toSocketError(
        error,
        'Unable to relay ICE candidate',
      );
    }
  }

  private relayCallMedia(
    client: Socket,
    payload: CallDescriptionPayload,
    type: 'offer' | 'answer',
  ) {
    const userId = this.authenticatedUserId(client);
    const callId = this.callId(payload?.callId);
    const sdp = readSessionDescription(
      payload?.sdp,
      type,
    );

    try {
      const delivery =
        type === 'offer'
          ? this.callSignaling.offer(
              userId,
              client.id,
              callId,
              sdp,
            )
          : this.callSignaling.answer(
              userId,
              client.id,
              callId,
              sdp,
            );

      this.deliverCallMedia(delivery);

      return { callId };
    } catch (error) {
      throw this.toSocketError(
        error,
        type === 'offer'
          ? 'Unable to relay offer'
          : 'Unable to relay answer',
      );
    }
  }

  private deliverCallNotices(
    notices: CallNotice[],
  ) {
    for (const notice of notices) {
      for (const socketId of this.socketIdsForUser(
        notice.userId,
      )) {
        if (socketId === notice.exceptSocketId) {
          continue;
        }

        this.server
          .to(socketId)
          .emit(
            notice.event,
            notice.payload,
          );
      }
    }
  }

  private notifyCallHistoryChanged(
    notices: CallNotice[],
  ) {
    const notified = new Set<string>();

    for (const notice of notices) {
      const conversationId =
        notice.payload.conversationId;

      if (notified.has(notice.userId)) {
        continue;
      }

      notified.add(notice.userId);

      const socketIds = this.socketIdsForUser(notice.userId);

      console.log('[CALL HISTORY] emitting', {
        userId: notice.userId,
        socketIds,
        callId: notice.payload.callId,
        conversationId,
      });

      for (const socketId of socketIds) {
        this.server
          .to(socketId)
          .emit('call_history_updated', {
            callId: notice.payload.callId,
            conversationId,
          });
      }
    }
  }

  private deliverCallMedia(
    delivery: CallMediaDelivery,
  ) {
    this.server
      .to(delivery.socketId)
      .emit(
        delivery.event,
        delivery.payload,
      );
  }

  private socketIdsForUser(
    userId: string,
  ): string[] {
    const direct = this.onlineSockets.get(userId);

    if (direct) {
      return [...direct];
    }

    const target = userId.toLowerCase();

    for (const [key, sockets] of this.onlineSockets) {
      if (key.toLowerCase() === target) {
        return [...sockets];
      }
    }

    return [];
  }

  private callId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !isUUID(value)
    ) {
      throw new WsException('Invalid call id');
    }

    return value;
  }

  private async authenticate(
    socket: Socket,
  ): Promise<string> {
    const token = socket.handshake.auth?.token;

    if (
      typeof token !== 'string' ||
      token.trim().length === 0
    ) {
      throw new Error('Unauthorized');
    }

    const payload =
      await this.jwtService.verifyAsync<JwtPayload>(
        token,
      );

    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0
    ) {
      throw new Error('Unauthorized');
    }

    return payload.sub;
  }

  private authenticatedUserId(
    client: Socket,
  ): string {
    const userId = client.data.userId;

    if (
      typeof userId !== 'string' ||
      userId.length === 0
    ) {
      throw new WsException('Unauthorized');
    }

    return userId;
  }

  private conversationId(
    value: unknown,
  ): string {
    if (
      typeof value !== 'string' ||
      !isUUID(value)
    ) {
      throw new WsException(
        'Invalid conversation id',
      );
    }

    return value;
  }

  private messageId(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !isUUID(value)
    ) {
      throw new WsException(
        'Invalid message id',
      );
    }

    return value;
  }

  private optionalMessageId(
    value: unknown,
  ): string | null {
    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {
      return null;
    }

    if (
      typeof value !== 'string' ||
      !isUUID(value)
    ) {
      throw new WsException(
        'Invalid message id',
      );
    }

    return value;
  }

  private reactionValue(
    value: unknown,
  ): string {
    if (
      typeof value !== 'string' ||
      !ALLOWED_MESSAGE_REACTIONS.some(
        (reaction) => reaction === value,
      )
    ) {
      throw new WsException(
        'Reaction is not supported',
      );
    }

    return value;
  }

  private optionalMessageContent(
    value: unknown,
  ): string {
    if (
      value === undefined ||
      value === null
    ) {
      return '';
    }

    if (typeof value !== 'string') {
      throw new WsException(
        'Message content is required',
      );
    }

    const content = value.trim();

    if (
      content.length >
      MESSAGE_MAX_LENGTH
    ) {
      throw new WsException(
        'Message content must be at most 5000 characters',
      );
    }

    return content;
  }

  private messageContent(
    value: unknown,
  ): string {
    if (typeof value !== 'string') {
      throw new WsException(
        'Message content is required',
      );
    }

    const content = value.trim();

    if (content.length === 0) {
      throw new WsException(
        'Message content is required',
      );
    }

    if (
      content.length >
      MESSAGE_MAX_LENGTH
    ) {
      throw new WsException(
        'Message content must be at most 5000 characters',
      );
    }

    return content;
  }

  private toSocketError(
    error: unknown,
    fallback: string,
  ): WsException {
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
