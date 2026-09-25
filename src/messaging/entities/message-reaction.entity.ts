import { CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Column } from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { Message } from './message.entity';

@Entity('message_reactions')
@Index('IDX_message_reactions_messageId', ['messageId'])
@Index('IDX_message_reactions_userId', ['userId'])
export class MessageReaction {
  @PrimaryColumn({ type: 'uuid' })
  messageId: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'messageId' })
  message: Message;

  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 16 })
  reaction: string;

  @CreateDateColumn()
  createdAt: Date;
}
