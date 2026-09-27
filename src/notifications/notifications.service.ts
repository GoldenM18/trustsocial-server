import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Notification } from './entities/notification.entity';
import { NotificationDelivery } from './notification-delivery';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export type CreateNotificationInput = {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  relatedUserId?: string | null;
  relatedConversationId?: string | null;
  relatedMessageId?: string | null;
};

export type NotificationView = {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  message: string;
  relatedUserId: string | null;
  relatedConversationId: string | null;
  relatedMessageId: string | null;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    private readonly notificationDelivery: NotificationDelivery,
  ) {}

  async createNotification(input: CreateNotificationInput): Promise<NotificationView> {
    const saved = await this.notificationsRepository.save(
      this.notificationsRepository.create({
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        message: input.message,
        relatedUserId: input.relatedUserId ?? null,
        relatedConversationId: input.relatedConversationId ?? null,
        relatedMessageId: input.relatedMessageId ?? null,
        isRead: false,
      }),
    );
    const notification = toNotificationView(saved);

    this.notificationDelivery.deliver(notification.recipientId, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      relatedUserId: notification.relatedUserId,
      relatedConversationId: notification.relatedConversationId,
      relatedMessageId: notification.relatedMessageId,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
    });

    return notification;
  }

  async listNotifications(userId: string, page = DEFAULT_PAGE, limit = DEFAULT_LIMIT) {
    const safePage = normalizePage(page);
    const safeLimit = normalizeLimit(limit);
    const [notifications, total] = await this.notificationsRepository.findAndCount({
      where: { recipientId: userId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      notifications: notifications.map(toNotificationView),
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    };
  }

  async markNotificationAsRead(userId: string, notificationId: string): Promise<NotificationView> {
    const updated = await this.notificationsRepository.update(
      { id: notificationId, recipientId: userId },
      { isRead: true },
    );

    if (!updated.affected) {
      throw new NotFoundException('Notification not found');
    }

    const notification = await this.notificationsRepository.findOne({
      where: { id: notificationId, recipientId: userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return toNotificationView(notification);
  }

  async markAllNotificationsAsRead(userId: string): Promise<{ updated: number }> {
    const updated = await this.notificationsRepository.update(
      { recipientId: userId, isRead: false },
      { isRead: true },
    );

    return { updated: updated.affected ?? 0 };
  }
}

function normalizePage(page: number): number {
  if (!Number.isInteger(page) || page < 1) {
    return DEFAULT_PAGE;
  }

  return page;
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(limit, MAX_LIMIT);
}

function toNotificationView(notification: Notification): NotificationView {
  return {
    id: notification.id,
    recipientId: notification.recipientId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    relatedUserId: notification.relatedUserId ?? null,
    relatedConversationId: notification.relatedConversationId ?? null,
    relatedMessageId: notification.relatedMessageId ?? null,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  };
}
