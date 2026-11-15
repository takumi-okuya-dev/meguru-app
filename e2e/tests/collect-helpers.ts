// 集金管理のE2Eの共通の部品（specs/collect/001-event-day-collection）。利用の許可・イベント・名簿を DB に直接入れる。
// 集金管理の表は共通の resetAll が空にする。共通の e2e/tests/helpers.ts には足さない（docs/parallel-development.md 11-1）。
import pg from "pg";
import { worktreeDbName } from "../env";
import { testUserEmail } from "./helpers";

const DIRECT_DB = process.env.E2E_DATABASE_URL_DIRECT ?? `postgres://postgres:postgres@localhost:5432/${worktreeDbName()}`;

/**
 * DB に直接つないで処理する。
 * @param run - 処理
 * @returns 処理の結果
 */
export async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: DIRECT_DB });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * ログインした人に集金管理を開き、イベント（区分1つ・払い方は現金とPayPayと振込）と名簿の3人を入れる。
 * @returns イベントの番号
 */
export async function seedEvent(): Promise<string> {
  return withDb(async (db) => {
    const { rows: users } = await db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [testUserEmail()]);
    const userId = users[0]!.id;
    await db.query("INSERT INTO app_access_grants (user_id, app) VALUES ($1, 'collect') ON CONFLICT DO NOTHING", [userId]);
    const { rows: events } = await db.query<{ id: string }>(
      "INSERT INTO collect.events (owner_user_id, name, starts_at, venue, next_number) VALUES ($1, 'E2Eの交流会', now() + interval '1 hour', '渋谷', 4) RETURNING id",
      [userId],
    );
    const eventId = events[0]!.id;
    const { rows: tiers } = await db.query<{ id: string }>(
      "INSERT INTO collect.price_tiers (event_id, name, amount, position) VALUES ($1, '通常', 3000, 0) RETURNING id",
      [eventId],
    );
    const people = [
      [1, "松本 れい", "まつもとれい"],
      [2, "井上 そら", "いのうえそら"],
      [3, "木村 ゆうき", "きむらゆうき"],
    ] as const;
    for (const [number, name, key] of people) {
      await db.query(
        "INSERT INTO collect.roster_people (event_id, number, name, name_key, media, price_tier_id) VALUES ($1, $2, $3, $4, 'peatix', $5)",
        [eventId, number, name, key, tiers[0]!.id],
      );
    }
    return eventId;
  });
}
