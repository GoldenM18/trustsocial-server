import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class CreatePostInteractions1791700000000
  implements MigrationInterface
{
  name = 'CreatePostInteractions1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'post_likes',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'postId',
            type: 'uuid',
          },
          {
            name: 'userId',
            type: 'uuid',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'now()',
          },
        ],
        uniques: [
          new TableUnique({
            name: 'UQ_post_likes_post_user',
            columnNames: ['postId', 'userId'],
          }),
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'post_likes',
      new TableIndex({
        name: 'IDX_post_likes_postId',
        columnNames: ['postId'],
      }),
    );

    await queryRunner.createIndex(
      'post_likes',
      new TableIndex({
        name: 'IDX_post_likes_userId',
        columnNames: ['userId'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'post_comments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'postId',
            type: 'uuid',
          },
          {
            name: 'userId',
            type: 'uuid',
          },
          {
            name: 'content',
            type: 'text',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'post_comments',
      new TableIndex({
        name: 'IDX_post_comments_postId',
        columnNames: ['postId'],
      }),
    );

    await queryRunner.createIndex(
      'post_comments',
      new TableIndex({
        name: 'IDX_post_comments_userId',
        columnNames: ['userId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'post_comments',
      'IDX_post_comments_userId',
    );
    await queryRunner.dropIndex(
      'post_comments',
      'IDX_post_comments_postId',
    );
    await queryRunner.dropTable('post_comments');

    await queryRunner.dropIndex(
      'post_likes',
      'IDX_post_likes_userId',
    );
    await queryRunner.dropIndex(
      'post_likes',
      'IDX_post_likes_postId',
    );
    await queryRunner.dropTable('post_likes');
  }
}
