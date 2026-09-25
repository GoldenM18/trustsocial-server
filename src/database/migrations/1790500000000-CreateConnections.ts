import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConnections1790500000000 implements MigrationInterface {
  name = 'CreateConnections1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "connections_status_enum" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requesterId" uuid NOT NULL, "recipientId" uuid NOT NULL, "status" "connections_status_enum" NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_connections" PRIMARY KEY ("id"), CONSTRAINT "CHK_connections_not_self" CHECK ("requesterId" <> "recipientId"), CONSTRAINT "FK_connections_requester" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE, CONSTRAINT "FK_connections_recipient" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_connections_active_pair" ON "connections" (LEAST("requesterId", "recipientId"), GREATEST("requesterId", "recipientId")) WHERE "status" IN ('PENDING', 'ACCEPTED')`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_connections_requesterId" ON "connections" ("requesterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_connections_recipientId" ON "connections" ("recipientId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "connections"`);
    await queryRunner.query(`DROP TYPE "connections_status_enum"`);
  }
}
