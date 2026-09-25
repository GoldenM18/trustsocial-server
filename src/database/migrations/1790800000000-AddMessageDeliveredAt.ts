import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMessageDeliveredAt1790800000000 implements MigrationInterface {
  name = 'AddMessageDeliveredAt1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'messages',
      new TableColumn({
        name: 'deliveredAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('messages', 'deliveredAt');
  }
}
