import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Repository } from 'typeorm';

import { Connection, ConnectionStatus } from '../connections/entities/connection.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import { ALLOWED_MESSAGE_REACTIONS } from './dto/set-reaction.dto';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { Conversation } from './entities/conversation.entity';
import { MessageAttachment } from './entities/message-attachment.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { MessageUserDeletion } from './entities/message-user-deletion.entity';
import { Message } from './entities/message.entity';
import { ListMessagesDto } from './dto/list-messages.dto';
import { SearchMessagesDto } from './dto/search-messages.dto';
import {
  detectImageMime,
  extensionForMessageImage,
  MESSAGE_IMAGE_MAX_BYTES,
  type MessageImageUpload,
  MessageAttachmentStorage,
  normalizeImageMime,
} from './storage/message-attachment-storage';

const DELETED_MESSAGE_CONTENT = 'Message deleted';
const IMAGE_INBOX_PREVIEW = '📷 Image';
const IMAGE_REPLY_PREVIEW = 'Image';

type PublicUser = {
  id: string;
  fullName: string;
  username: string;
  profilePhotoUrl: string | null;
  isVerified: boolean;
  isOnline: boolean;
};

type ConversationListItem = {
  id: string;
  conversationId: string;
  user: PublicUser;
  lastMessage: {
    id: string;
    content: string;
    senderId: string;
    createdAt: Date;
    deliveredAt: Date | null;
    readAt: Date | null;
  } | null;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type ConversationResponse = {
  id: string;
  participantIds: [string, string];
  createdAt: Date;
  updatedAt: Date;
};

export type MessageReplyPreview = {
  messageId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: Date;
  isDeleted: boolean;
};

type VisibleMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: 'text' | 'call';
  callId: string | null;
  callStatus: 'completed' | 'rejected' | 'missed' | null;
  callDurationSeconds: number | null;
  createdAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  editedAt: Date | null;
  deletedForEveryone: boolean;
  reactions: MessageReactionCount[];
  replyTo: MessageReplyPreview | null;
  attachments: MessageAttachmentView[];
};

export type MessageAttachmentView = {
  id: string;
  type: 'image';
  mimeType: string;
  originalName: string;
  url: string;
  size: number;
  createdAt: Date;
};

export type MessageReactionCount = {
  reaction: string;
  count: number;
  reactedByMe: boolean;
};

export type MessageReactionSummary = {
  messageId: string;
  reactions: MessageReactionCount[];
};

export type MessageReactionChange = {
  messageId: string;
  conversationId: string;
  entries: { userId: string; reaction: string }[];
  summary: MessageReactionSummary;
};

type UnreadCountRow = {
  conversationId: string;
  unreadCount: string;
};

function activityTime(conversation: ConversationListItem): number {
  const messageTime = conversation.lastMessage?.createdAt.getTime() ?? 0;
  return Math.max(messageTime, conversation.updatedAt.getTime());
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Conversation)
    private readonly conversationsRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messagesRepository: Repository<Message>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Connection)
    private readonly connectionsRepository: Repository<Connection>,
    private readonly messageAttachmentStorage: MessageAttachmentStorage,
    private readonly notificationsService: NotificationsService,
  ) {}

  async list(userId: string): Promise<{ conversations: ConversationListItem[] }> {
    const conversations = await this.conversationsRepository.find({
      where: [{ participantLowId: userId }, { participantHighId: userId }],
      relations: {
        participantLow: true,
        participantHigh: true,
      },
      select: {
        id: true,
        participantLowId: true,
        participantHighId: true,
        createdAt: true,
        updatedAt: true,
        participantLow: {
          id: true,
          fullName: true,
          username: true,
          profilePhotoUrl: true,
          isVerified: true,
          isOnline: true,
        },
        participantHigh: {
          id: true,
          fullName: true,
          username: true,
          profilePhotoUrl: true,
          isVerified: true,
          isOnline: true,
        },
      },
      order: {
        updatedAt: 'DESC',
      },
    });

    if (conversations.length === 0) {
      return { conversations: [] };
    }

    const conversationIds = conversations.map((conversation) => conversation.id);

    const [latestMessages, unreadRows] = await Promise.all([
      this.messagesRepository
        .createQueryBuilder('message')
        .select([
          'message.id',
          'message.conversationId',
          'message.content',
          'message.senderId',
          'message.createdAt',
          'message.deliveredAt',
          'message.readAt',
          'message.deletedForEveryoneAt',
        ])
        .distinctOn(['message.conversationId'])
        .where('message.conversationId IN (:...conversationIds)', { conversationIds })
        .andWhere(messageHiddenForUserSql('message'), { userId })
        .orderBy('message.conversationId', 'ASC')
        .addOrderBy('message.createdAt', 'DESC')
        .addOrderBy('message.id', 'DESC')
        .getMany(),
      this.messagesRepository
        .createQueryBuilder('message')
        .select('message.conversationId', 'conversationId')
        .addSelect('COUNT(*)', 'unreadCount')
        .where('message.conversationId IN (:...conversationIds)', { conversationIds })
        .andWhere('message.senderId <> :userId', { userId })
        .andWhere('message.readAt IS NULL')
        .groupBy('message.conversationId')
        .getRawMany<UnreadCountRow>(),
    ]);

    const imageOnlyIds = latestMessages
      .filter((message) => !message.deletedForEveryoneAt && message.content.trim().length === 0)
      .map((message) => message.id);
    const imageAttachmentRows =
      imageOnlyIds.length === 0
        ? []
        : await this.dataSource.getRepository(MessageAttachment).find({
            where: { messageId: In(imageOnlyIds), type: 'image' },
            select: { messageId: true },
          });
    const imageOnlyMessageIds = new Set(imageAttachmentRows.map((row) => row.messageId.toLowerCase()));
    const latestByConversationId = new Map(
      latestMessages.map((message) => [message.conversationId, message]),
    );
    const unreadByConversationId = new Map(
      unreadRows.flatMap((row) => {
        const count = Number(row.unreadCount);

        if (!row.conversationId || !Number.isFinite(count)) {
          return [];
        }

        return [[row.conversationId, count] as const];
      }),
    );

    const items = conversations.map((conversation) => {
      const otherUser = isSameUser(conversation.participantLowId, userId)
        ? conversation.participantHigh
        : conversation.participantLow;
      const lastMessage = latestByConversationId.get(conversation.id) ?? null;

      return {
        id: conversation.id,
        conversationId: conversation.id,
        user: toPublicUser(otherUser),
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              content: inboxLastMessageContent(
                lastMessage,
                imageOnlyMessageIds.has(lastMessage.id.toLowerCase()),
              ),
              senderId: lastMessage.senderId,
              createdAt: lastMessage.createdAt,
              deliveredAt: lastMessage.deliveredAt ?? null,
              readAt: lastMessage.readAt ?? null,
            }
          : null,
        unreadCount: unreadByConversationId.get(conversation.id) ?? 0,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      };
    });

    items.sort((left, right) => activityTime(right) - activityTime(left));

    return { conversations: items };
  }

  async findOrCreate(currentUserId: string, targetUserId: string): Promise<ConversationResponse> {
    const target = await this.usersRepository.findOne({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!target) {
      throw new NotFoundException('User not found');
    }

    if (currentUserId.toLowerCase() === targetUserId.toLowerCase()) {
      throw new BadRequestException('You cannot start a conversation with yourself');
    }

    const accepted = await this.connectionsRepository.findOne({
      where: [
        {
          requesterId: currentUserId,
          recipientId: targetUserId,
          status: ConnectionStatus.ACCEPTED,
        },
        {
          requesterId: targetUserId,
          recipientId: currentUserId,
          status: ConnectionStatus.ACCEPTED,
        },
      ],
      select: { id: true },
    });

    if (!accepted) {
      throw new ForbiddenException('An accepted connection is required to start a conversation');
    }

    const [participantLowId, participantHighId] = orderParticipantIds(
      currentUserId,
      targetUserId,
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(Conversation, {
          where: { participantLowId, participantHighId },
        });

        if (existing) {
          return toConversationResponse(existing);
        }

        const saved = await manager.save(
          manager.create(Conversation, { participantLowId, participantHighId }),
        );

        await manager.save([
          manager.create(ConversationParticipant, {
            conversationId: saved.id,
            userId: participantLowId,
          }),
          manager.create(ConversationParticipant, {
            conversationId: saved.id,
            userId: participantHighId,
          }),
        ]);

        return toConversationResponse(saved);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const existing = await this.conversationsRepository.findOne({
        where: { participantLowId, participantHighId },
      });

      if (!existing) {
        throw error;
      }

      return toConversationResponse(existing);
    }
  }

  async sendMessage(
    currentUserId: string,
    conversationId: string,
    content: string,
    replyToMessageId?: string | null,
  ): Promise<VisibleMessage> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const conversation = await manager.findOne(Conversation, {
        where: { id: conversationId },
        select: {
          id: true,
          participantLowId: true,
          participantHighId: true,
        },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      const isParticipant =
        isSameUser(conversation.participantLowId, currentUserId) ||
        isSameUser(conversation.participantHighId, currentUserId);

      if (!isParticipant) {
        throw new ForbiddenException('You are not a participant in this conversation');
      }

      const messageId = randomUUID();
      const normalizedReplyId = await this.resolveReplyTarget(
        manager,
        conversationId,
        messageId,
        replyToMessageId,
      );

      const message = await manager.save(
        manager.create(Message, {
          id: messageId,
          conversationId,
          senderId: currentUserId,
          content,
          replyToMessageId: normalizedReplyId,
        }),
      );

      await manager.update(Conversation, { id: conversationId }, { updatedAt: new Date() });

      const recipientId = isSameUser(conversation.participantLowId, currentUserId)
        ? conversation.participantHighId
        : conversation.participantLowId;

      return { message, recipientId };
    });

    await this.notificationsService.createNotification({
      recipientId: saved.recipientId,
      type: 'new_message',
      title: 'New message',
      message: 'You received a new message.',
      relatedUserId: saved.message.senderId,
      relatedConversationId: saved.message.conversationId,
      relatedMessageId: saved.message.id,
    });

    return this.presentMessage(saved.message, currentUserId);
  }

  async deleteMessageForEveryone(
    currentUserId: string,
    conversationId: string,
    messageId: string,
  ): Promise<VisibleMessage> {
    await this.assertConversationAccess(currentUserId, conversationId);
    const message = await this.findConversationMessage(conversationId, messageId);

    if (!isSameUser(message.senderId, currentUserId)) {
      throw new ForbiddenException('You can only delete your own message for everyone');
    }

    if (!message.deletedForEveryoneAt) {
      await this.dataSource
        .createQueryBuilder()
        .update(Message)
        .set({ deletedForEveryoneAt: () => 'CURRENT_TIMESTAMP' })
        .where('id = :messageId::uuid', { messageId })
        .andWhere('"deletedForEveryoneAt" IS NULL')
        .updateEntity(false)
        .execute();
    }

    await this.purgeMessageAttachments(messageId);

    return this.presentMessage(
      await this.findConversationMessage(conversationId, messageId),
      currentUserId,
    );
  }

  async deleteMessageForMe(
    currentUserId: string,
    conversationId: string,
    messageId: string,
  ): Promise<{ conversationId: string; messageId: string }> {
    await this.assertConversationAccess(currentUserId, conversationId);
    await this.findConversationMessage(conversationId, messageId);

    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(MessageUserDeletion)
      .values({ messageId, userId: currentUserId })
      .orIgnore()
      .execute();

    return { conversationId, messageId };
  }

  async editMessage(
    currentUserId: string,
    messageId: string,
    content: string,
  ): Promise<VisibleMessage> {
    const nextContent = content.trim();

    if (nextContent.length === 0) {
      throw new BadRequestException('Message content is required');
    }

    if (nextContent.length > 5000) {
      throw new BadRequestException('Message content must be at most 5000 characters');
    }

    const message = await this.messagesRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.assertConversationAccess(currentUserId, message.conversationId);

    if (!isSameUser(message.senderId, currentUserId)) {
      throw new ForbiddenException('You can only edit your own message');
    }

    if (message.deletedForEveryoneAt) {
      throw new BadRequestException('Deleted messages cannot be edited');
    }

    const hidden = await this.dataSource.getRepository(MessageUserDeletion).findOne({
      where: { messageId, userId: currentUserId },
      select: { messageId: true },
    });

    if (hidden) {
      throw new BadRequestException('Deleted messages cannot be edited');
    }

    const updated = await this.dataSource
      .createQueryBuilder()
      .update(Message)
      .set({
        content: nextContent,
        editedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :messageId::uuid', { messageId })
      .andWhere('"senderId" = :userId::uuid', { userId: currentUserId })
      .andWhere('"deletedForEveryoneAt" IS NULL')
      .updateEntity(false)
      .execute();

    if (updated.affected === 0) {
      throw new BadRequestException('Deleted messages cannot be edited');
    }

    return this.presentMessage(
      await this.findConversationMessage(message.conversationId, messageId),
      currentUserId,
    );
  }

  async visibleMessageForViewer(messageId: string, viewerId: string): Promise<VisibleMessage> {
    const message = await this.messagesRepository.findOne({ where: { id: messageId } });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.assertConversationAccess(viewerId, message.conversationId);
    return this.presentMessage(message, viewerId);
  }

  async setMessageReaction(
    currentUserId: string,
    messageId: string,
    reaction: string,
  ): Promise<MessageReactionChange> {
    if (!isAllowedReaction(reaction)) {
      throw new BadRequestException('Reaction is not supported');
    }

    const message = await this.findReactableMessage(currentUserId, messageId);

    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(MessageReaction)
      .values({ messageId: message.id, userId: currentUserId, reaction })
      .orUpdate(['reaction'], ['messageId', 'userId'])
      .execute();

    return this.reactionChange(message, currentUserId);
  }

  async removeMessageReaction(
    currentUserId: string,
    messageId: string,
  ): Promise<MessageReactionChange> {
    const message = await this.findReactableMessage(currentUserId, messageId);

    await this.dataSource.getRepository(MessageReaction).delete({
      messageId: message.id,
      userId: currentUserId,
    });

    return this.reactionChange(message, currentUserId);
  }

  async assertConversationAccess(currentUserId: string, conversationId: string): Promise<void> {
    const conversation = await this.conversationsRepository.findOne({
      where: { id: conversationId },
      select: {
        id: true,
        participantLowId: true,
        participantHighId: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const isParticipant =
      isSameUser(conversation.participantLowId, currentUserId) ||
      isSameUser(conversation.participantHighId, currentUserId);

    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }
  }

  async markConversationAsDelivered(
    conversationId: string,
    userId: string,
  ): Promise<{ messageIds: string[] }> {
    await this.assertConversationAccess(userId, conversationId);

    const updated = await this.dataSource
      .createQueryBuilder()
      .update(Message)
      .set({ deliveredAt: () => 'CURRENT_TIMESTAMP' })
      .where('"conversationId" = :conversationId::uuid', { conversationId })
      .andWhere('"senderId" <> :userId::uuid', { userId })
      .andWhere('"deliveredAt" IS NULL')
      .returning(['id'])
      .updateEntity(false)
      .execute();

    const rows = Array.isArray(updated.raw) ? updated.raw : [];

    return {
      messageIds: rows.flatMap((row: unknown) => {
        if (!row || typeof row !== 'object' || !('id' in row)) {
          return [];
        }

        const id = (row as { id?: unknown }).id;
        return typeof id === 'string' ? [id] : [];
      }),
    };
  }

  async markConversationAsRead(
    conversationId: string,
    userId: string,
  ): Promise<{ messageIds: string[] }> {
    await this.assertConversationAccess(userId, conversationId);

    const updated = await this.dataSource
      .createQueryBuilder()
      .update(Message)
      .set({ readAt: () => 'CURRENT_TIMESTAMP' })
      .where('"conversationId" = :conversationId::uuid', { conversationId })
      .andWhere('"senderId" <> :userId::uuid', { userId })
      .andWhere('"readAt" IS NULL')
      .returning(['id'])
      .updateEntity(false)
      .execute();

    const rows = Array.isArray(updated.raw) ? updated.raw : [];

    return {
      messageIds: rows.flatMap((row: unknown) => {
        if (!row || typeof row !== 'object' || !('id' in row)) {
          return [];
        }

        const id = (row as { id?: unknown }).id;
        return typeof id === 'string' ? [id] : [];
      }),
    };
  }

  async listMessages(currentUserId: string, conversationId: string, query: ListMessagesDto) {
    const conversation = await this.conversationsRepository.findOne({
      where: { id: conversationId },
      select: {
        id: true,
        participantLowId: true,
        participantHighId: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const isParticipant =
      isSameUser(conversation.participantLowId, currentUserId) ||
      isSameUser(conversation.participantHighId, currentUserId);

    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const [messages, total] = await this.messagesRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .andWhere(messageHiddenForUserSql('message'), { userId: currentUserId })
      .orderBy('message.createdAt', 'ASC')
      .addOrderBy('message.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const reactionsByMessageId = await this.reactionsForMessages(
      messages.map((message) => message.id),
      currentUserId,
    );
    const repliesByMessageId = await this.replyPreviewsByMessageId(messages, currentUserId);
    const attachmentsByMessageId = await this.attachmentsByMessageId(messages.map((message) => message.id));

    return {
      messages: messages.map((message) => ({
        ...toVisibleMessage(message),
        reactions: reactionsByMessageId.get(message.id) ?? [],
        replyTo: repliesByMessageId.get(message.id) ?? null,
        attachments: message.deletedForEveryoneAt ? [] : attachmentsByMessageId.get(message.id) ?? [],
      })),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async searchMessages(currentUserId: string, conversationId: string, query: SearchMessagesDto) {
    await this.assertConversationAccess(currentUserId, conversationId);

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const term = query.q.trim();

    if (term.length === 0) {
      throw new BadRequestException('Search query is required');
    }

    const [messages, total] = await this.messagesRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .andWhere('message.deletedForEveryoneAt IS NULL')
      .andWhere(messageHiddenForUserSql('message'), { userId: currentUserId })
      .andWhere("btrim(message.content) <> ''")
      .andWhere('strpos(lower(message.content), lower(:term)) > 0', { term })
      .orderBy('message.createdAt', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const reactionsByMessageId = await this.reactionsForMessages(
      messages.map((message) => message.id),
      currentUserId,
    );
    const repliesByMessageId = await this.replyPreviewsByMessageId(messages, currentUserId);
    const attachmentsByMessageId = await this.attachmentsByMessageId(messages.map((message) => message.id));

    return {
      items: messages.map((message) => ({
        ...toVisibleMessage(message),
        reactions: reactionsByMessageId.get(message.id) ?? [],
        replyTo: repliesByMessageId.get(message.id) ?? null,
        attachments: attachmentsByMessageId.get(message.id) ?? [],
      })),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private async findConversationMessage(conversationId: string, messageId: string): Promise<Message> {
    const message = await this.messagesRepository.findOne({
      where: { id: messageId, conversationId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  private async findReactableMessage(currentUserId: string, messageId: string): Promise<Message> {
    const message = await this.messagesRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.assertConversationAccess(currentUserId, message.conversationId);

    if (message.deletedForEveryoneAt) {
      throw new BadRequestException('Deleted messages cannot be reacted to');
    }

    const hidden = await this.dataSource.getRepository(MessageUserDeletion).findOne({
      where: { messageId: message.id, userId: currentUserId },
      select: { messageId: true },
    });

    if (hidden) {
      throw new BadRequestException('Deleted messages cannot be reacted to');
    }

    return message;
  }

  private async reactionChange(message: Message, currentUserId: string): Promise<MessageReactionChange> {
    const entries = await this.reactionEntries([message.id]);

    return {
      messageId: message.id,
      conversationId: message.conversationId,
      entries,
      summary: summarizeMessageReactions(message.id, entries, currentUserId),
    };
  }

  private async reactionsForMessages(
    messageIds: string[],
    viewerId: string,
  ): Promise<Map<string, MessageReactionCount[]>> {
    const entries = await this.reactionEntries(messageIds);
    const grouped = new Map<string, { userId: string; reaction: string }[]>();

    for (const entry of entries) {
      const current = grouped.get(entry.messageId) ?? [];
      current.push(entry);
      grouped.set(entry.messageId, current);
    }

    return new Map(
      messageIds.map((messageId) => [
        messageId,
        summarizeMessageReactions(messageId, grouped.get(messageId) ?? [], viewerId).reactions,
      ]),
    );
  }

  private async reactionEntries(
    messageIds: string[],
  ): Promise<{ messageId: string; userId: string; reaction: string }[]> {
    if (messageIds.length === 0) {
      return [];
    }

    const rows = await this.dataSource.getRepository(MessageReaction).find({
      where: { messageId: In(messageIds) },
      select: { messageId: true, userId: true, reaction: true },
    });

    return rows.map((row) => ({
      messageId: row.messageId,
      userId: row.userId,
      reaction: row.reaction,
    }));
  }

  private async resolveReplyTarget(
    manager: EntityManager,
    conversationId: string,
    messageId: string,
    replyToMessageId?: string | null,
  ): Promise<string | null> {
    if (!replyToMessageId) {
      return null;
    }

    if (isSameUser(replyToMessageId, messageId)) {
      throw new BadRequestException('A message cannot reply to itself');
    }

    const parent = await manager.findOne(Message, {
      where: { id: replyToMessageId },
      select: { id: true, conversationId: true },
    });

    if (!parent || !isSameUser(parent.conversationId, conversationId)) {
      throw new NotFoundException('Message not found');
    }

    return parent.id;
  }

  private async presentMessage(message: Message, viewerId: string): Promise<VisibleMessage> {
    const replies = await this.replyPreviewsByMessageId([message], viewerId);
    const attachments = message.deletedForEveryoneAt
      ? []
      : (await this.attachmentsByMessageId([message.id])).get(message.id) ?? [];

    return {
      ...toVisibleMessage(message),
      replyTo: replies.get(message.id) ?? null,
      attachments,
    };
  }

  private async replyPreviewsByMessageId(
    messages: Pick<Message, 'id' | 'replyToMessageId'>[],
    viewerId: string,
  ): Promise<Map<string, MessageReplyPreview | null>> {
    const parentIds = [
      ...new Set(messages.flatMap((message) => (message.replyToMessageId ? [message.replyToMessageId] : []))),
    ];

    if (parentIds.length === 0) {
      return new Map(messages.map((message) => [message.id, null]));
    }

    const parents = await this.messagesRepository.find({
      where: { id: In(parentIds) },
      select: {
        id: true,
        senderId: true,
        content: true,
        createdAt: true,
        deletedForEveryoneAt: true,
      },
    });
    const parentById = new Map(parents.map((parent) => [parent.id.toLowerCase(), parent]));
    const senderIds = [...new Set(parents.map((parent) => parent.senderId))];
    const senders =
      senderIds.length === 0
        ? []
        : await this.usersRepository.find({
            where: { id: In(senderIds) },
            select: { id: true, fullName: true, username: true },
          });
    const senderById = new Map(senders.map((sender) => [sender.id.toLowerCase(), sender]));
    const hiddenRows = await this.dataSource.getRepository(MessageUserDeletion).find({
      where: { userId: viewerId, messageId: In(parentIds) },
      select: { messageId: true },
    });
    const hiddenIds = new Set(hiddenRows.map((row) => row.messageId.toLowerCase()));
    const blankParentIds = parents
      .filter((parent) => !parent.deletedForEveryoneAt && parent.content.trim().length === 0)
      .map((parent) => parent.id);
    const imageRows =
      blankParentIds.length === 0
        ? []
        : await this.dataSource.getRepository(MessageAttachment).find({
            where: { messageId: In(blankParentIds), type: 'image' },
            select: { messageId: true },
          });
    const imageParentIds = new Set(imageRows.map((row) => row.messageId.toLowerCase()));

    return new Map(
      messages.map((message) => {
        if (!message.replyToMessageId) {
          return [message.id, null] as const;
        }

        const parent = parentById.get(message.replyToMessageId.toLowerCase());

        if (!parent) {
          return [message.id, null] as const;
        }

        const isDeleted =
          parent.deletedForEveryoneAt != null || hiddenIds.has(parent.id.toLowerCase());

        return [
          message.id,
          {
            messageId: parent.id,
            senderId: parent.senderId,
            senderName: displayName(senderById.get(parent.senderId.toLowerCase())),
            content: isDeleted
              ? DELETED_MESSAGE_CONTENT
              : parent.content.trim().length === 0 && imageParentIds.has(parent.id.toLowerCase())
                ? IMAGE_REPLY_PREVIEW
                : parent.content,
            createdAt: parent.createdAt,
            isDeleted,
          },
        ] as const;
      }),
    );
  }

  async addMessageImage(
    currentUserId: string,
    conversationId: string,
    messageId: string,
    file: MessageImageUpload,
    publicBaseUrl: string,
  ): Promise<{ attachment: MessageAttachmentView; message: VisibleMessage }> {
    await this.assertConversationAccess(currentUserId, conversationId);
    const message = await this.findConversationMessage(conversationId, messageId);

    if (!isSameUser(message.senderId, currentUserId)) {
      throw new ForbiddenException('You can only attach images to your own message');
    }

    if (message.deletedForEveryoneAt) {
      throw new BadRequestException('Deleted messages cannot receive attachments');
    }

    const hidden = await this.dataSource.getRepository(MessageUserDeletion).findOne({
      where: { messageId: message.id, userId: currentUserId },
      select: { messageId: true },
    });

    if (hidden) {
      throw new BadRequestException('Deleted messages cannot receive attachments');
    }

    const detected = detectImageMime(file.buffer);
    const declared = normalizeImageMime(file.mimetype);

    if (!detected || !declared || detected !== declared) {
      throw new BadRequestException('Only JPEG, PNG, WebP, and GIF images are allowed');
    }

    if (file.size > MESSAGE_IMAGE_MAX_BYTES || file.buffer.length > MESSAGE_IMAGE_MAX_BYTES) {
      throw new PayloadTooLargeException('Image must be at most 5 MB');
    }

    if (file.buffer.length === 0) {
      throw new BadRequestException('An image file is required');
    }

    const attachmentId = randomUUID();
    const storageKey = `${randomUUID()}${extensionForMessageImage(detected)}`;
    const url = `${publicBaseUrl.replace(/\/$/, '')}/message-attachments/${attachmentId}`;
    const originalName = safeOriginalName(file.originalname);

    await this.messageAttachmentStorage.save(file.buffer, storageKey);

    try {
      await this.dataSource.getRepository(MessageAttachment).insert({
        id: attachmentId,
        messageId: message.id,
        type: 'image',
        mimeType: detected,
        originalName,
        storageKey,
        url,
        size: file.buffer.length,
      });
    } catch (error) {
      await this.messageAttachmentStorage.remove(storageKey);
      throw error;
    }

    const saved = await this.dataSource.getRepository(MessageAttachment).findOne({
      where: { id: attachmentId },
    });

    if (!saved) {
      await this.messageAttachmentStorage.remove(storageKey);
      throw new NotFoundException('Attachment not found');
    }

    return {
      attachment: toAttachmentView(saved),
      message: await this.presentMessage(message, currentUserId),
    };
  }

  async openMessageImage(
    viewerId: string,
    attachmentId: string,
  ): Promise<{ stream: import('node:fs').ReadStream; mimeType: string; size: number }> {
    const attachment = await this.dataSource.getRepository(MessageAttachment).findOne({
      where: { id: attachmentId },
    });

    if (!attachment || attachment.type !== 'image') {
      throw new NotFoundException('Attachment not found');
    }

    const message = await this.messagesRepository.findOne({ where: { id: attachment.messageId } });

    if (!message || message.deletedForEveryoneAt) {
      throw new NotFoundException('Attachment not found');
    }

    try {
      await this.assertConversationAccess(viewerId, message.conversationId);
    } catch {
      throw new NotFoundException('Attachment not found');
    }

    const hidden = await this.dataSource.getRepository(MessageUserDeletion).findOne({
      where: { messageId: message.id, userId: viewerId },
      select: { messageId: true },
    });

    if (hidden) {
      throw new NotFoundException('Attachment not found');
    }

    const stream = await this.messageAttachmentStorage.open(attachment.storageKey);

    if (!stream) {
      throw new NotFoundException('Attachment not found');
    }

    return {
      stream,
      mimeType: attachment.mimeType,
      size: attachment.size,
    };
  }

  private async purgeMessageAttachments(messageId: string): Promise<void> {
    const rows = await this.dataSource.getRepository(MessageAttachment).find({
      where: { messageId },
      select: { id: true, storageKey: true },
    });

    for (const row of rows) {
      await this.messageAttachmentStorage.remove(row.storageKey);
    }

    if (rows.length > 0) {
      await this.dataSource.getRepository(MessageAttachment).delete({ messageId });
    }
  }

  private async attachmentsByMessageId(messageIds: string[]): Promise<Map<string, MessageAttachmentView[]>> {
    if (messageIds.length === 0) {
      return new Map();
    }

    const rows = await this.dataSource.getRepository(MessageAttachment).find({
      where: { messageId: In(messageIds) },
      select: {
        id: true,
        messageId: true,
        type: true,
        mimeType: true,
        originalName: true,
        url: true,
        size: true,
        createdAt: true,
      },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const grouped = new Map<string, MessageAttachmentView[]>();

    for (const row of rows) {
      if (row.type !== 'image') {
        continue;
      }

      const current = grouped.get(row.messageId) ?? [];
      current.push(toAttachmentView(row));
      grouped.set(row.messageId, current);
    }

    return grouped;
  }
}

function isSameUser(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function messageHiddenForUserSql(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM "message_user_deletions" hidden
    WHERE hidden."messageId" = "${alias}"."id"
      AND hidden."userId" = :userId::uuid
  )`;
}

function toVisibleMessage(message: Message): VisibleMessage {
  const deletedForEveryone = message.deletedForEveryoneAt != null;

  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    content: deletedForEveryone ? DELETED_MESSAGE_CONTENT : message.content,
    messageType: message.messageType,
    callId: message.callId ?? null,
    callStatus: message.callStatus ?? null,
    callDurationSeconds: message.callDurationSeconds ?? null,
    createdAt: message.createdAt,
    deliveredAt: message.deliveredAt ?? null,
    readAt: message.readAt ?? null,
    editedAt: message.editedAt ?? null,
    deletedForEveryone,
    reactions: [],
    replyTo: null,
    attachments: [],
  };
}

function inboxLastMessageContent(
  message: Pick<Message, 'content' | 'deletedForEveryoneAt'>,
  hasImage: boolean,
): string {
  if (message.deletedForEveryoneAt) {
    return DELETED_MESSAGE_CONTENT;
  }

  if (message.content.trim().length > 0) {
    return message.content;
  }

  if (hasImage) {
    return IMAGE_INBOX_PREVIEW;
  }

  return message.content;
}

function toAttachmentView(row: Pick<MessageAttachment, 'id' | 'mimeType' | 'originalName' | 'url' | 'size' | 'createdAt'>): MessageAttachmentView {
  return {
    id: row.id,
    type: 'image',
    mimeType: row.mimeType,
    originalName: row.originalName,
    url: row.url,
    size: row.size,
    createdAt: row.createdAt,
  };
}

function safeOriginalName(originalName: string): string {
  const base = originalName.split(/[/\\]/).pop() ?? 'image';
  const cleaned = base.replace(/[^\w.\- ()]/g, '').slice(0, 255);
  return cleaned.length > 0 ? cleaned : 'image';
}

function displayName(user: Pick<User, 'fullName' | 'username'> | undefined): string {
  const fullName = user?.fullName?.trim();

  if (fullName) {
    return fullName;
  }

  return user?.username ?? '';
}

export function summarizeMessageReactions(
  messageId: string,
  entries: { userId: string; reaction: string }[],
  viewerId: string,
): MessageReactionSummary {
  const counts = new Map<string, { count: number; reactedByMe: boolean }>();

  for (const entry of entries) {
    if (!isAllowedReaction(entry.reaction)) {
      continue;
    }

    const current = counts.get(entry.reaction) ?? { count: 0, reactedByMe: false };
    current.count += 1;

    if (isSameUser(entry.userId, viewerId)) {
      current.reactedByMe = true;
    }

    counts.set(entry.reaction, current);
  }

  return {
    messageId,
    reactions: ALLOWED_MESSAGE_REACTIONS.flatMap((reaction) => {
      const current = counts.get(reaction);

      if (!current || current.count < 1) {
        return [];
      }

      return [{ reaction, count: current.count, reactedByMe: current.reactedByMe }];
    }),
  };
}

function isAllowedReaction(reaction: string): boolean {
  return ALLOWED_MESSAGE_REACTIONS.some((allowed) => allowed === reaction);
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    isVerified: user.isVerified,
    isOnline: user.isOnline,
  };
}

function orderParticipantIds(firstUserId: string, secondUserId: string): [string, string] {
  const first = firstUserId.toLowerCase();
  const second = secondUserId.toLowerCase();

  return first < second ? [first, second] : [second, first];
}

function toConversationResponse(conversation: Conversation): ConversationResponse {
  return {
    id: conversation.id,
    participantIds: [conversation.participantLowId, conversation.participantHighId],
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    typeof error.driverError === 'object' &&
    error.driverError !== null &&
    'code' in error.driverError &&
    error.driverError.code === '23505'
  );
}
