// 0019_external_media のテスト（specs/021-external-media data-model.md）。
// 宣伝内容に event を足し、掲載内容と媒体の既定値の表を足すだけ。媒体・状況・画像の種類・掲載URLを CHECK で拒み、
// 宣伝内容・Accountを消すと消えることを確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyMigrations, createScratchDb, migrationIndex } from "../helpers/migrate";

let client: pg.Client;
let drop: () => Promise<void>;
let accountId: string;
let promotionId: string;

beforeAll(async () => {
  ({ client, drop } = await createScratchDb());
  await applyMigrations(client, 0, migrationIndex("0019") - 1);
  accountId = (
    await client.query<{ id: string }>(
      `INSERT INTO accounts (name, connection_status, connection_method) VALUES ('店', 'not_connected', NULL) RETURNING id`,
    )
  ).rows[0]!.id;
  promotionId = (
    await client.query<{ id: string }>(
      `INSERT INTO promotions (account_id, title, content) VALUES ($1, 't', 'c') RETURNING id`,
      [accountId],
    )
  ).rows[0]!.id;
  await applyMigrations(client, migrationIndex("0019"), migrationIndex("0019"));
});

afterAll(async () => {
  await drop?.();
});

const addListing = (values: Record<string, unknown> = {}) =>
  client.query(
    `INSERT INTO promotion_listings (promotion_id, account_id, media, status, image_style, posted_url) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      promotionId,
      accountId,
      values.media ?? "peatix",
      values.status ?? "not_started",
      values.imageStyle ?? "illustration",
      values.postedUrl ?? null,
    ],
  );

describe("0019_external_media", () => {
  it("今の宣伝内容の event は NULL", async () => {
    const { rows } = await client.query(`SELECT event FROM promotions WHERE id = $1`, [
      promotionId,
    ]);
    expect(rows[0]!.event).toBeNull();
  });

  it("媒体・状況・画像の種類・掲載URLを CHECK で拒む", async () => {
    await expect(addListing({ media: "twitter" })).rejects.toThrow();
    await expect(addListing({ status: "done" })).rejects.toThrow();
    await expect(addListing({ imageStyle: "3d" })).rejects.toThrow();
    await expect(addListing({ postedUrl: "ftp://x" })).rejects.toThrow();
    await addListing({ postedUrl: "https://peatix.com/event/1" });
    await expect(addListing()).rejects.toThrow(); // 主キー（宣伝内容×媒体）
    await expect(
      client.query(`INSERT INTO media_defaults (account_id, media) VALUES ($1, 'xx')`, [accountId]),
    ).rejects.toThrow();
  });

  it("宣伝内容を消すと掲載内容が、Accountを消すと既定値が消える", async () => {
    await client.query(
      `INSERT INTO media_defaults (account_id, media, values) VALUES ($1, 'kokuchpro', '{"officeName":"港"}')`,
      [accountId],
    );
    await client.query(`DELETE FROM promotions WHERE id = $1`, [promotionId]);
    expect((await client.query(`SELECT 1 FROM promotion_listings`)).rowCount).toBe(0);
    await client.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    expect((await client.query(`SELECT 1 FROM media_defaults`)).rowCount).toBe(0);
  });
});
