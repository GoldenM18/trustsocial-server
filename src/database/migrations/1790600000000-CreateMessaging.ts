import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMessaging1790600000000 implements MigrationInterface {
  name = 'CreateMessaging1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "participantLowId" uuid NOT NULL, "participantHighId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_conversations" PRIMARY KEY ("id"), CONSTRAINT "CHK_conversations_ordered_pair" CHECK ("participantLowId" < "participantHighId"), CONSTRAINT "UQ_conversations_participant_pair" UNIQUE ("participantLowId", "participantHighId"), CONSTRAINT "FK_conversations_participantLow" FOREIGN KEY ("participantLowId") REFERENCES "users"("id") ON DELETE CASCADE, CONSTRAINT "FK_conversations_participantHigh" FOREIGN KEY ("participantHighId") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE TABLE "conversation_participants" ("conversationId" uuid NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_conversation_participants" PRIMARY KEY ("conversationId", "userId"), CONSTRAINT "FK_conversation_participants_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE, CONSTRAINT "FK_conversation_participants_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_participants_userId" ON "conversation_participants" ("userId")`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversationId" uuid NOT NULL, "senderId" uuid NOT NULL, "content" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_messages" PRIMARY KEY ("id"), CONSTRAINT "FK_messages_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE, CONSTRAINT "FK_messages_sender" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_conversationId_createdAt" ON "messages" ("conversationId", "createdAt", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_senderId" ON "messages" ("senderId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP TABLE "conversation_participants"`);
    await queryRunner.query(`DROP TABLE "conversations"`);
  }
}
