import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { Connection, ConnectionStatus } from '../connections/entities/connection.entity';
import { User } from '../users/entities/user.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { ListMessagesDto } from './dto/list-messages.dto';

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
  user: PublicUser;
  lastMessage: {
    id: string;
    content: string;
    senderId: string;
    createdAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

type ConversationResponse = {
  id: string;
  participantIds: [string, string];
  createdAt: Date;
  updatedAt: Date;
};

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

    const latestMessages = await this.messagesRepository
      .createQueryBuilder('message')
      .select([
        'message.id',
        'message.conversationId',
        'message.content',
        'message.senderId',
        'message.createdAt',
      ])
      .distinctOn(['message.conversationId'])
      .where('message.conversationId IN (:...conversationIds)', {
        conversationIds: conversations.map((conversation) => conversation.id),
      })
      .orderBy('message.conversationId', 'ASC')
      .addOrderBy('message.createdAt', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .getMany();

    const latestByConversationId = new Map(
      latestMessages.map((message) => [message.conversationId, message]),
    );

    return {
      conversations: conversations.map((conversation) => {
        const otherUser = isSameUser(conversation.participantLowId, userId)
          ? conversation.participantHigh
          : conversation.participantLow;
        const lastMessage = latestByConversationId.get(conversation.id);

        return {
          id: conversation.id,
          user: toPublicUser(otherUser),
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                content: lastMessage.content,
                senderId: lastMessage.senderId,
                createdAt: lastMessage.createdAt,
              }
            : null,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        };
      }),
    };
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

  async sendMessage(currentUserId: string, conversationId: string, content: string) {
    return this.dataSource.transaction(async (manager) => {
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

      const message = await manager.save(
        manager.create(Message, {
          conversationId,
          senderId: currentUserId,
          content,
        }),
      );

      await manager.update(Conversation, { id: conversationId }, { updatedAt: new Date() });

      return {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        content: message.content,
        createdAt: message.createdAt,
      };
    });
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

    const [messages, total] = await this.messagesRepository.findAndCount({
      where: { conversationId },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        createdAt: true,
      },
      order: {
        createdAt: 'ASC',
        id: 'ASC',
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      messages: messages.map((message) => ({
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        content: message.content,
        createdAt: message.createdAt,
      })),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }
}

function isSameUser(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
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
