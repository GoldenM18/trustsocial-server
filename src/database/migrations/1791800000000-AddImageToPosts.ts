import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddImageToPosts1791800000000
  implements MigrationInterface
{
  name = 'AddImageToPosts1791800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'posts',
      new TableColumn({
        name: 'imageUrl',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('posts', 'imageUrl');
  }
}
