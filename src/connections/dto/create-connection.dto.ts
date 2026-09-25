import { IsUUID } from 'class-validator';

export class CreateConnectionDto {
  @IsUUID()
  recipientId: string;
}
