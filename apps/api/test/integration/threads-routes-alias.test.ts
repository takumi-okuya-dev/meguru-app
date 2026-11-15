// Threadsの道筋は /api/threads/… だけ（specs/meguru/029-threads-pattern1 tasks.md T057、contracts/api-routes.md 3）。
// PR4 で新しい道筋を足し、画面が新しい道筋だけを呼ぶことを確かめてから、PR5 で古い道筋（/api/accounts/… など）を消した。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { makeTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

describe("Threadsの道筋", () => {
  it("新しい道筋は答え、古い道筋は 404", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { teamId } = await makeTeam("u1", [accountId]);
    for (const path of [`/accounts/${accountId}`, `/accounts/${accountId}/post-drafts`, `/teams/${teamId}`, "/me/needs-review-counts"]) {
      expect((await call(app, "GET", `/api/threads${path}`, { user: "u1" })).status, path).toBe(200);
      expect((await call(app, "GET", `/api${path}`, { user: "u1" })).status, path).toBe(404);
    }
  });
});
