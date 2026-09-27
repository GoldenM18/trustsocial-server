import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotifications1791400000000 implements MigrationInterface {
  name = 'CreateNotifications1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recipientId" uuid NOT NULL, "type" character varying(100) NOT NULL, "title" character varying(255) NOT NULL, "message" text NOT NULL, "relatedUserId" uuid, "relatedConversationId" uuid, "relatedMessageId" uuid, "isRead" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_notifications" PRIMARY KEY ("id"), CONSTRAINT "FK_notifications_recipient" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE, CONSTRAINT "FK_notifications_relatedUser" FOREIGN KEY ("relatedUserId") REFERENCES "users"("id") ON DELETE SET NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipientId_createdAt" ON "notifications" ("recipientId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipientId_isRead" ON "notifications" ("recipientId", "isRead")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
