import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMessageDeletion1790900000000 implements MigrationInterface {
  name = 'AddMessageDeletion1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'messages',
      new TableColumn({
        name: 'deletedForEveryoneAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );
    await queryRunner.query(
      `CREATE TABLE "message_user_deletions" ("messageId" uuid NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_message_user_deletions" PRIMARY KEY ("messageId", "userId"), CONSTRAINT "FK_message_user_deletions_message" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE, CONSTRAINT "FK_message_user_deletions_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_user_deletions_userId" ON "message_user_deletions" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "message_user_deletions"`);
    await queryRunner.dropColumn('messages', 'deletedForEveryoneAt');
  }
}
