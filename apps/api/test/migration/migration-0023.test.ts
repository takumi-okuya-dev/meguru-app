// 0023_connection_notice のテスト（specs/025-threads-account-guide data-model.md 1-1、T013）。列を2つ足すだけ。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0023") - 1);
  await client.query(`INSERT INTO tester_applications (threads_username) VALUES ('shop_tokyo')`);
  await applyMigrations(client, migrationIndex("0023"), migrationIndex("0023"));
});

afterAll(async () => {
  await drop?.();
});

describe("0023_connection_notice", () => {
  it("connected_threads_user_id は text・NULL可・既定値なしで、今ある行は NULL", async () => {
    const col = (
      await client.query(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'tester_applications' AND column_name = 'connected_threads_user_id'`,
      )
    ).rows[0];
    expect(col).toEqual({ data_type: "text", is_nullable: "YES", column_default: null });
    expect((await client.query(`SELECT connected_threads_user_id FROM tester_applications`)).rows).toEqual([
      { connected_threads_user_id: null },
    ]);
  });

  it("mismatch_notice_dismissed_at は timestamptz・NULL可・既定値なしで、今ある行は NULL", async () => {
    const col = (
      await client.query(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'tester_applications' AND column_name = 'mismatch_notice_dismissed_at'`,
      )
    ).rows[0];
    expect(col).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES", column_default: null });
    expect((await client.query(`SELECT mismatch_notice_dismissed_at FROM tester_applications`)).rows).toEqual([
      { mismatch_notice_dismissed_at: null },
    ]);
  });
});
