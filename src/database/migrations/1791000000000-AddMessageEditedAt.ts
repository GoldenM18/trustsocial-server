import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMessageEditedAt1791000000000 implements MigrationInterface {
  name = 'AddMessageEditedAt1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'messages',
      new TableColumn({
        name: 'editedAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('messages', 'editedAt');
  }
}
