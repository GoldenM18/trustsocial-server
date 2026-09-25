import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Connection } from '../connections/entities/connection.entity';
import { UsersModule } from '../users/users.module';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { Conversation } from './entities/conversation.entity';
import { MessageAttachment } from './entities/message-attachment.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { MessageUserDeletion } from './entities/message-user-deletion.entity';
import { Message } from './entities/message.entity';
import { MessageAttachmentsController } from './message-attachments.controller';
import { MessagingController } from './messaging.controller';
import { MessagesController } from './messages.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';
import { LocalMessageAttachmentStorage } from './storage/local-message-attachment.storage';
import { MessageAttachmentStorage } from './storage/message-attachment-storage';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      ConversationParticipant,
      Connection,
      Message,
      MessageUserDeletion,
      MessageReaction,
      MessageAttachment,
    ]),
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [MessagingController, MessagesController, MessageAttachmentsController],
  providers: [
    MessagingService,
    MessagingGateway,
    {
      provide: MessageAttachmentStorage,
      useClass: LocalMessageAttachmentStorage,
    },
  ],
})
export class MessagingModule {}
