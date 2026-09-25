import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMessageAttachments1791300000000 implements MigrationInterface {
  name = 'CreateMessageAttachments1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "message_attachments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "messageId" uuid NOT NULL, "type" character varying(32) NOT NULL, "mimeType" character varying(64) NOT NULL, "originalName" character varying(255) NOT NULL, "storageKey" character varying(255) NOT NULL, "url" character varying(1024) NOT NULL, "size" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_message_attachments" PRIMARY KEY ("id"), CONSTRAINT "CHK_message_attachments_type" CHECK ("type" = 'image'), CONSTRAINT "CHK_message_attachments_mime" CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')), CONSTRAINT "CHK_message_attachments_size" CHECK ("size" > 0 AND "size" <= 5242880), CONSTRAINT "FK_message_attachments_message" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_attachments_messageId" ON "message_attachments" ("messageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "message_attachments"`);
  }
}
