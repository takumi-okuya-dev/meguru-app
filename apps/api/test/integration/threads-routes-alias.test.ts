// Threadsの新しい道筋（/api/threads/…）と古い道筋が、同じ応答を返す（specs/meguru/029-threads-pattern1 tasks.md T049、contracts/api-routes.md 3）。
// 古い道筋は PR5 で消す。それまでは、API が画面より先にデプロイされても動くよう、両方に同じ処理をつなぐ。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { makeTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

/**
 * 古い道筋と新しい道筋を同じ人で呼び、状態コードと中身を返す。
 * @param user - 呼ぶ人
 * @param path - /api のあとの古い道筋
 * @returns 古い道筋と新しい道筋の結果
 */
async function both(user: string, path: string) {
  const read = async (p: string) => {
    const res = await call(app, "GET", p, { user });
    return { status: res.status, body: await res.json() };
  };
  return { old: await read(`/api${path}`), next: await read(`/api/threads${path}`) };
}

describe("Threadsの新しい道筋", () => {
  it("アカウント・投稿の案の一覧・チーム・要確認の数で、古い道筋と同じ応答を返す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { teamId } = await makeTeam("u1", [accountId]);
    for (const path of [`/accounts/${accountId}`, `/accounts/${accountId}/post-drafts`, `/teams/${teamId}`, "/me/needs-review-counts"]) {
      const { old, next } = await both("u1", path);
      expect(old.status, path).toBe(200);
      expect(next, path).toEqual(old);
    }
  });

  it("持ち主でない人のエラーも同じ（状態コードとエラーコード）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await createUserWithAccount("u2");
    const { old, next } = await both("u2", `/accounts/${accountId}`);
    expect(old.status).toBeGreaterThanOrEqual(400);
    expect(next).toEqual(old);
  });
});
