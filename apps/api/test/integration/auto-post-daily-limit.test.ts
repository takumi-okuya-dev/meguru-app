// US3：自動投稿の時刻の処理は、オーナーの1日の投稿数の上限の数までだけ（specs/024 research.md R7、FR-020、T042）
import { beforeEach, describe, expect, it } from "vitest";
import { call, fake, makeApp, resetDb, testEnv, setUserLimit } from "../helpers/app";
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
    await setUserLimit({ clerkUserId: "u1" }, "daily_posts", 5);
    expect(await runDay(accountId, "2026-11-10")).toEqual([7, 8, 9, 10, 11]);
    const [row] = (await db()`SELECT slot_minutes FROM threads.posting_schedules WHERE account_id = ${accountId}`) as { slot_minutes: number[] }[];
    expect(row!.slot_minutes).toHaveLength(8);
  });

  it("上限を戻すと、8つすべて使う", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, Array.from({ length: 8 }, (_, i) => `案${i}`));
    await setSchedule(accountId, { slotMinutes: EIGHT });
    expect(await runDay(accountId, "2026-11-10")).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
  });
});

// PR #71 のセルフレビュー：上限は、投稿の直前の確認・自動投稿の状態の件数・プロンプトの1日の投稿数にも効く
describe("上限が効く、ほかの場所", () => {
  it("一覧を読んだ後に上限が下がっても、投稿の直前の確認で上限の数を超えない（daily_limit）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, Array.from({ length: 8 }, (_, i) => `案${i}`));
    await setSchedule(accountId, { slotMinutes: EIGHT });
    // 7〜9時の3つを投稿したあと、上限を2に下げる。10時の時刻は上限の外なので、試みを作らない
    for (const h of ["07", "08", "09"]) await run(jst(`2026-11-10 ${h}:00`));
    await setUserLimit({ clerkUserId: "u1" }, "daily_posts", 2);
    await run(jst("2026-11-10 10:00"));
    const rows = await attempts(accountId);
    expect(rows.filter((r) => r.state !== "skipped")).toHaveLength(3);
    expect(rows.some((r) => new Date(r.slot_at as string).getTime() === jst("2026-11-10 10:00").getTime())).toBe(false);
  });

  it("自動投稿の状態の slotCount と、プロンプトの1日の投稿数は、上限の数まで", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await setSchedule(accountId, { slotMinutes: EIGHT });
    await setUserLimit({ clerkUserId: "u1" }, "daily_posts", 5);
    const status = (await (await call(app, "GET", `/api/accounts/${accountId}/auto-post`, { user: "u1" })).json()) as {
      slotCount?: number;
      state?: { slotCount: number };
    };
    expect(JSON.stringify(status)).toContain('"slotCount":5');
    const prompt = (await (await call(app, "GET", `/api/accounts/${accountId}/prompt?count=10`, { user: "u1" })).json()) as { prompt: string };
    expect(prompt.prompt).not.toContain("1日の投稿は8件");
  });
});
