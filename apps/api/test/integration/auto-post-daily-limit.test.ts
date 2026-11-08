// US3：自動投稿の時刻の処理は、オーナーの1日の投稿数の上限の数までだけ（specs/024 research.md R7、FR-020、T042）
import { beforeEach, describe, expect, it } from "vitest";
import { fake, makeApp, resetDb, testEnv } from "../helpers/app";
import { approvedDrafts, attempts, connectedAccount, db, jst, run, setSchedule } from "../helpers/auto-post";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await testEnv.AUTOPOST_KV.delete("autopost:wake");
});

/** 8つの時刻（7:00〜14:00、1時間おき）。 */
const EIGHT = Array.from({ length: 8 }, (_, i) => (7 + i) * 60);

/**
 * その日の各時刻のちょうどに処理を動かし、試みの時刻（日本時間の時）を返す。
 * @param accountId - accounts.id
 * @returns 試みを作った時（7〜14）
 */
async function runDay(accountId: string, day: string) {
  for (const m of EIGHT) await run(jst(`${day} ${String(m / 60).padStart(2, "0")}:00`));
  return (await attempts(accountId)).map((a) => (new Date(a.slot_at as string).getUTCHours() + 9) % 24);
}

describe("1日の投稿数の上限", () => {
  it("時刻が8つでも、上限が5なら早い5つだけ試みを作る。時刻の行は消えない", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, Array.from({ length: 8 }, (_, i) => `案${i}`));
    await setSchedule(accountId, { slotMinutes: EIGHT });
    await db()`UPDATE users SET daily_post_limit = 5 WHERE clerk_user_id = 'u1'`;
    expect(await runDay(accountId, "2026-11-10")).toEqual([7, 8, 9, 10, 11]);
    const [row] = (await db()`SELECT slot_minutes FROM posting_schedules WHERE account_id = ${accountId}`) as { slot_minutes: number[] }[];
    expect(row!.slot_minutes).toHaveLength(8);
  });

  it("上限を戻すと、8つすべて使う", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, Array.from({ length: 8 }, (_, i) => `案${i}`));
    await setSchedule(accountId, { slotMinutes: EIGHT });
    expect(await runDay(accountId, "2026-11-10")).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
  });
});
