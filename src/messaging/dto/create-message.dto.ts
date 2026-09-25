import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : ''))
  @IsString()
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}
