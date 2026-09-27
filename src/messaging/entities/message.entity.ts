import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { Conversation } from './conversation.entity';

@Entity('messages')
@Index(
  'IDX_messages_conversationId_createdAt',
  ['conversationId', 'createdAt', 'id'],
)
@Index('IDX_messages_senderId', ['senderId'])
@Index('IDX_messages_replyToMessageId', ['replyToMessageId'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @Column({ type: 'uuid' })
  senderId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'senderId' })
  sender: User;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'text',
  })
  messageType: 'text' | 'call';

  @Column({
    type: 'uuid',
    nullable: true,
  })
  callId: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  callStatus:
    | 'completed'
    | 'rejected'
    | 'missed'
    | null;

  @Column({
    type: 'integer',
    nullable: true,
  })
  callDurationSeconds: number | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  editedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deletedForEveryoneAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  replyToMessageId: string | null;

  @ManyToOne(() => Message, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'replyToMessageId' })
  replyToMessage?: Message | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
