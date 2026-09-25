import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageReadAt1790700000000 implements MigrationInterface {
  name = 'AddMessageReadAt1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" ADD "readAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "readAt"`);
  }
}
