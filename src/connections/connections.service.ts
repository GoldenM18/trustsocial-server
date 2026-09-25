import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';

import { User } from '../users/entities/user.entity';
import { Connection, ConnectionStatus } from './entities/connection.entity';

@Injectable()
export class ConnectionsService {
  constructor(
    @InjectRepository(Connection)
    private readonly connectionsRepository: Repository<Connection>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async createRequest(requesterId: string, recipientId: string) {
    if (requesterId === recipientId) {
      throw new BadRequestException('You cannot connect with yourself');
    }

    const recipient = await this.usersRepository.findOne({
      where: { id: recipientId },
      select: { id: true },
    });

    if (!recipient) {
      throw new NotFoundException('Recipient not found');
    }

    const existing = await this.connectionsRepository.find({
      where: [
        {
          requesterId,
          recipientId,
          status: In([ConnectionStatus.PENDING, ConnectionStatus.ACCEPTED]),
        },
        {
          requesterId: recipientId,
          recipientId: requesterId,
          status: In([ConnectionStatus.PENDING, ConnectionStatus.ACCEPTED]),
        },
      ],
    });

    if (existing.some((connection) => connection.status === ConnectionStatus.ACCEPTED)) {
      throw new ConflictException('You are already connected');
    }

    if (existing.some((connection) => connection.status === ConnectionStatus.PENDING)) {
      throw new ConflictException('A connection request is already pending');
    }

    const connection = this.connectionsRepository.create({
      requesterId,
      recipientId,
      status: ConnectionStatus.PENDING,
    });

    try {
      const saved = await this.connectionsRepository.save(connection);

      return {
        id: saved.id,
        requesterId: saved.requesterId,
        recipientId: saved.recipientId,
        status: saved.status,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A connection already exists between these users');
      }

      throw error;
    }
  }

  async accept(userId: string, connectionId: string) {
    const connection = await this.connectionsRepository.findOne({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.recipientId !== userId) {
      throw new ForbiddenException('Only the recipient can accept this connection');
    }

    if (connection.status === ConnectionStatus.ACCEPTED) {
      throw new ConflictException('Connection is already accepted');
    }

    if (connection.status === ConnectionStatus.REJECTED) {
      throw new ConflictException('Connection is rejected');
    }

    connection.status = ConnectionStatus.ACCEPTED;

    const saved = await this.connectionsRepository.save(connection);

    return {
      id: saved.id,
      requesterId: saved.requesterId,
      recipientId: saved.recipientId,
      status: saved.status,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  }

  async reject(userId: string, connectionId: string) {
    const connection = await this.connectionsRepository.findOne({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.recipientId !== userId) {
      throw new ForbiddenException('Only the recipient can reject this connection');
    }

    if (connection.status === ConnectionStatus.ACCEPTED) {
      throw new ConflictException('Connection is already accepted');
    }

    if (connection.status === ConnectionStatus.REJECTED) {
      throw new ConflictException('Connection is already rejected');
    }

    connection.status = ConnectionStatus.REJECTED;

    const saved = await this.connectionsRepository.save(connection);

    return {
      id: saved.id,
      requesterId: saved.requesterId,
      recipientId: saved.recipientId,
      status: saved.status,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  }

  async cancel(userId: string, connectionId: string) {
    const connection = await this.connectionsRepository.findOne({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.requesterId !== userId) {
      throw new ForbiddenException('Only the requester can cancel this connection');
    }

    if (connection.status === ConnectionStatus.ACCEPTED) {
      throw new ConflictException('Connection is already accepted');
    }

    if (connection.status === ConnectionStatus.REJECTED) {
      throw new ConflictException('Connection is already rejected');
    }

    await this.connectionsRepository.delete(connection.id);
  }

  async remove(userId: string, connectionId: string) {
    const connection = await this.connectionsRepository.findOne({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (connection.requesterId !== userId && connection.recipientId !== userId) {
      throw new ForbiddenException('Only people in this connection can remove it');
    }

    if (connection.status === ConnectionStatus.PENDING) {
      throw new ConflictException('Connection is still pending');
    }

    if (connection.status === ConnectionStatus.REJECTED) {
      throw new ConflictException('Connection is already rejected');
    }

    await this.connectionsRepository.delete(connection.id);
  }

  async listAccepted(userId: string) {
    const connections = await this.connectionsRepository.find({
      where: [
        { status: ConnectionStatus.ACCEPTED, requesterId: userId },
        { status: ConnectionStatus.ACCEPTED, recipientId: userId },
      ],
      relations: {
        requester: true,
        recipient: true,
      },
      select: {
        id: true,
        requesterId: true,
        recipientId: true,
        updatedAt: true,
        requester: {
          id: true,
          fullName: true,
          username: true,
          profilePhotoUrl: true,
          isVerified: true,
          isOnline: true,
        },
        recipient: {
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

    return {
      connections: connections.map((connection) => {
        const otherUser =
          connection.requesterId === userId
            ? connection.recipient
            : connection.requester;

        return {
          connectionId: connection.id,
          user: {
            id: otherUser.id,
            fullName: otherUser.fullName,
            username: otherUser.username,
            profilePhotoUrl: otherUser.profilePhotoUrl,
            isVerified: otherUser.isVerified,
            isOnline: otherUser.isOnline,
          },
        };
      }),
    };
  }

  async listIncoming(userId: string) {
    const connections = await this.connectionsRepository.find({
      where: {
        status: ConnectionStatus.PENDING,
        recipientId: userId,
      },
      relations: {
        requester: true,
      },
      select: {
        id: true,
        createdAt: true,
        requesterId: true,
        requester: {
          id: true,
          fullName: true,
          username: true,
          profilePhotoUrl: true,
          isVerified: true,
          isOnline: true,
        },
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return {
      requests: connections.map((connection) => ({
        connectionId: connection.id,
        requester: {
          id: connection.requester.id,
          fullName: connection.requester.fullName,
          username: connection.requester.username,
          profilePhotoUrl: connection.requester.profilePhotoUrl,
          isVerified: connection.requester.isVerified,
          isOnline: connection.requester.isOnline,
        },
      })),
    };
  }

  async listOutgoing(userId: string) {
    const connections = await this.connectionsRepository.find({
      where: {
        status: ConnectionStatus.PENDING,
        requesterId: userId,
      },
      relations: {
        recipient: true,
      },
      select: {
        id: true,
        createdAt: true,
        recipientId: true,
        recipient: {
          id: true,
          fullName: true,
          username: true,
          profilePhotoUrl: true,
          isVerified: true,
          isOnline: true,
        },
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return {
      requests: connections.map((connection) => ({
        connectionId: connection.id,
        recipient: {
          id: connection.recipient.id,
          fullName: connection.recipient.fullName,
          username: connection.recipient.username,
          profilePhotoUrl: connection.recipient.profilePhotoUrl,
          isVerified: connection.recipient.isVerified,
          isOnline: connection.recipient.isOnline,
        },
      })),
    };
  }
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
