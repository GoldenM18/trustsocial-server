import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageReplyTo1791200000000 implements MigrationInterface {
  name = 'AddMessageReplyTo1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" ADD "replyToMessageId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_replyToMessage" FOREIGN KEY ("replyToMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "CHK_messages_reply_not_self" CHECK ("replyToMessageId" IS NULL OR "replyToMessageId" <> "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_replyToMessageId" ON "messages" ("replyToMessageId")`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_message_reply_same_conversation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $fn$
      BEGIN
        IF NEW."replyToMessageId" IS NULL THEN
          RETURN NEW;
        END IF;

        IF NEW."replyToMessageId" = NEW.id THEN
          RAISE EXCEPTION 'A message cannot reply to itself';
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM "messages" parent
          WHERE parent.id = NEW."replyToMessageId"
            AND parent."conversationId" = NEW."conversationId"
        ) THEN
          RAISE EXCEPTION 'Reply must reference a message in the same conversation';
        END IF;

        RETURN NEW;
      END;
      $fn$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_messages_reply_same_conversation"
      BEFORE INSERT OR UPDATE OF "replyToMessageId", "conversationId"
      ON "messages"
      FOR EACH ROW
      EXECUTE FUNCTION enforce_message_reply_same_conversation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "trg_messages_reply_same_conversation" ON "messages"`);
    await queryRunner.query(`DROP FUNCTION enforce_message_reply_same_conversation()`);
    await queryRunner.query(`DROP INDEX "IDX_messages_replyToMessageId"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "CHK_messages_reply_not_self"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_replyToMessage"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "replyToMessageId"`);
  }
}
