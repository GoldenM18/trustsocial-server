import { IsIn } from 'class-validator';

export const ALLOWED_MESSAGE_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '😡'] as const;

export class SetReactionDto {
  @IsIn(ALLOWED_MESSAGE_REACTIONS)
  reaction: string;
}
