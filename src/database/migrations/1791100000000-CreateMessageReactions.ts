import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMessageReactions1791100000000 implements MigrationInterface {
  name = 'CreateMessageReactions1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "message_reactions" ("messageId" uuid NOT NULL, "userId" uuid NOT NULL, "reaction" character varying(16) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_message_reactions" PRIMARY KEY ("messageId", "userId"), CONSTRAINT "CHK_message_reactions_reaction" CHECK ("reaction" IN ('❤️', '👍', '😂', '😮', '😢', '😡')), CONSTRAINT "FK_message_reactions_message" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE, CONSTRAINT "FK_message_reactions_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_reactions_messageId" ON "message_reactions" ("messageId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_reactions_userId" ON "message_reactions" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "message_reactions"`);
  }
}
