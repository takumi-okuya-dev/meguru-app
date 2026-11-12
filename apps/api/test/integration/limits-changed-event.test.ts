// 上限の変更を出来事（limits.changed）で伝える（specs/meguru/029-threads-pattern1 tasks.md T019）。
// 運営者が上限を保存したのと同じトランザクションで出来事を書き、すぐ届ける。Threadsが受け取って自動投稿を起こす。
import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { db } from "../helpers/auto-post";
import { TESTER_OPERATOR, callT } from "../helpers/tester-invites";

const app = makeApp();
const OP = TESTER_OPERATOR;

beforeEach(async () => {
  await resetDb();
  await testEnv.AUTOPOST_KV.delete("autopost:wake");
});

const events = async () =>
  (await db().query(
    `SELECT e.payload, d.consumer, d.status FROM platform_events e JOIN platform_event_deliveries d ON d.event_id = e.id WHERE e.type = 'limits.changed' ORDER BY e.created_at`,
  )) as { payload: { app: string; userId?: string }; consumer: string; status: string }[];

describe("上限の変更の出来事（limits.changed）", () => {
  it("既定の値を保存すると出来事が書かれ、Threadsに届いて自動投稿が起こされる", async () => {
    expect((await callT(app, "PUT", "/api/operator/limits", { user: OP, body: { accountLimit: 5, dailyPostLimit: 8 } })).status).toBe(200);
    expect(await events()).toEqual([{ payload: { app: "threads" }, consumer: "threads", status: "done" }]);
    expect(await testEnv.AUTOPOST_KV.get("autopost:wake")).not.toBeNull();
  });

  it("人ごとの上限を保存すると、その人の番号つきで出来事が書かれる", async () => {
    await createUserWithAccount("u1");
    const userId = ((await db().query(`SELECT id FROM users WHERE clerk_user_id = 'u1'`)) as { id: string }[])[0]!.id;
    const res = await callT(app, "PUT", `/api/operator/limits/users/${userId}`, { user: OP, body: { accountLimit: 2, dailyPostLimit: null } });
    expect(res.status).toBe(200);
    expect(await events()).toEqual([{ payload: { app: "threads", userId }, consumer: "threads", status: "done" }]);
    expect(await testEnv.AUTOPOST_KV.get("autopost:wake")).not.toBeNull();
  });

  it("保存が失敗したら出来事も残らない", async () => {
    expect((await callT(app, "PUT", "/api/operator/limits", { user: OP, body: { accountLimit: 0, dailyPostLimit: 10 } })).status).toBe(400);
    expect(await events()).toEqual([]);
  });
});
