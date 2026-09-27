import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddCallHistoryToMessages1791500000000 implements MigrationInterface {
  name = 'AddCallHistoryToMessages1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'messages',
      new TableColumn({
        name: 'messageType',
        type: 'varchar',
        length: '20',
        default: "'text'",
      }),
    );

    await queryRunner.addColumn(
      'messages',
      new TableColumn({
        name: 'callId',
        type: 'uuid',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'messages',
      new TableColumn({
        name: 'callStatus',
        type: 'varchar',
        length: '20',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'messages',
      new TableColumn({
        name: 'callDurationSeconds',
        type: 'integer',
        isNullable: true,
      }),
    );

    await queryRunner.createIndex(
      'messages',
      new TableIndex({
        name: 'IDX_messages_callId',
        columnNames: ['callId'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('messages', 'IDX_messages_callId');
    await queryRunner.dropColumn('messages', 'callDurationSeconds');
    await queryRunner.dropColumn('messages', 'callStatus');
    await queryRunner.dropColumn('messages', 'callId');
    await queryRunner.dropColumn('messages', 'messageType');
  }
}
