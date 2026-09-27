import { Injectable } from '@nestjs/common';

export type NotificationRealtimePayload = {
  id: string;
  type: string;
  title: string;
  message: string;
  relatedUserId: string | null;
  relatedConversationId: string | null;
  relatedMessageId: string | null;
  isRead: boolean;
  createdAt: Date;
};

type DeliverNotification = (recipientId: string, notification: NotificationRealtimePayload) => void;

@Injectable()
export class NotificationDelivery {
  private deliverNotification: DeliverNotification | null = null;

  register(deliverNotification: DeliverNotification) {
    this.deliverNotification = deliverNotification;
  }

  deliver(recipientId: string, notification: NotificationRealtimePayload) {
    this.deliverNotification?.(recipientId, notification);
  }
}
