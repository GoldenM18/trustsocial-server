import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Connection } from '../connections/entities/connection.entity';
import { ConversationParticipant } from '../messaging/entities/conversation-participant.entity';
import { Conversation } from '../messaging/entities/conversation.entity';
import { MessageAttachment } from '../messaging/entities/message-attachment.entity';
import { MessageReaction } from '../messaging/entities/message-reaction.entity';
import { MessageUserDeletion } from '../messaging/entities/message-user-deletion.entity';
import { Message } from '../messaging/entities/message.entity';
import { User } from '../users/entities/user.entity';
import { Post } from '../posts/entities/post.entity';
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [User, Connection, Conversation, ConversationParticipant, Message, MessageUserDeletion, MessageReaction, MessageAttachment, Post],
  migrations: ['dist/database/migrations/*.js'],
});
