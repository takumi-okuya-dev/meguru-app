// US4：未接続のアカウントからは、Threadsに問い合わせない（specs/012 FR-032・FR-035、SC-005、research.md R5）。
// 毎日の処理・自動投稿・画面を開いたとき・投稿の権限の確認を動かしても、偽のThreadsへの要求が0回で、失敗や要再接続にならない。
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, publishAttempts } from "../../src/db/schema";
import { runDailyJobs } from "../../src/jobs/daily-jobs";
import { call, createAccountVia, db, fake, makeApp, resetDb, testEnv } from "../helpers/app";
import { approvedDrafts, jst, jstMinuteOf, run, setSchedule } from "../helpers/auto-post";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await testEnv.AUTOPOST_KV.delete("autopost:wake");
});

describe("未接続のアカウントとThreads（SC-005）", () => {
  it("毎日の処理・自動投稿・画面を開く・投稿の権限の確認で、Threadsへの要求が0回。状態は未接続のまま", async () => {
    const { accountId } = await createAccountVia(app, "u1", "カフェの公式");
    await approvedDrafts(accountId!, ["承認済みの案"]);
    // オンにはできない（FR-032）が、万一オンの行があっても投稿しないことを確かめるため、直接入れる
    const at = jst("2030-01-10 12:00");
    await setSchedule(accountId!, { slotMinutes: [jstMinuteOf(at)], enabled: true });
    const before = await fake.callCounts();

    await runDailyJobs(testEnv, at);
    await run(at);
    await call(app, "POST", `/api/threads/accounts/${accountId}/open`, { user: "u1", body: { clientId: "p", openSeq: 1 } });
    const check = await call(app, "POST", `/api/threads/accounts/${accountId}/threads-check`, { user: "u1" });
    expect(await check.json()).toEqual({ status: "not_connected" });

    expect((await fake.callCounts()).total).toBe(before.total);
    expect(await db().select().from(publishAttempts)).toHaveLength(0);
    const [row] = await db().select().from(accounts).where(eq(accounts.id, accountId!));
    expect(row!.connectionStatus).toBe("not_connected");
  });
});
