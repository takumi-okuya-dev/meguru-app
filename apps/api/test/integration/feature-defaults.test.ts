// 何もしなければ今までどおり（specs/019-feature-switches US2、FR-003・FR-011、SC-003）。
// 機能の設定の行がない人は3つすべてONで、プロンプトは前と同じ。決済の制限はゆるまない。
import { FEATURES } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { authorizeAccount } from "../../src/platform/access/access";
import { getPrompt } from "../../src/services/prompt-service";
import { call, createAccountVia, createUserWithAccount, db, endTrial, makeApp, resetDb } from "../helpers/app";
import { billingEnv } from "../helpers/billing";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

describe("設定のない人", () => {
  it("プロンプトは、3つすべてONのときと同じ", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    await call(app, "POST", `/api/accounts/${accountId}/reference-posts`, { user: "u1", body: { body: "参考", keyword: "転職", whyGood: "数字" } });
    const viaApi = (await (await call(app, "GET", `/api/accounts/${accountId}/prompt`, { user: "u1" })).json()) as { prompt: string };
    const access = await authorizeAccount(db(), { id: userId, billing: { enabled: false } }, accountId, "view");
    const direct = await getPrompt(db(), access.account, access.account.promptPostCount, new Set(FEATURES));
    expect(viaApi.prompt).toBe(direct.prompt);
    expect(direct.materials).not.toBeNull();
  });

  it("新しく登録した人のアカウントも、/access の features が3つすべて", async () => {
    await call(app, "GET", "/api/me", { user: "newbie" });
    const account = await createAccountVia(app, "newbie");
    const res = await call(app, "GET", `/api/accounts/${account.accountId}/access`, { user: "newbie" });
    expect(((await res.json()) as { features: string[] }).features).toEqual([...FEATURES]);
  });
});

describe("決済の制限はゆるまない（FR-011）", () => {
  it("無料体験が終わった未契約の人は、3つすべてONでも今までどおり読むだけ", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    await endTrial(userId);
    const res = await call(app, "POST", `/api/accounts/${accountId}/reference-posts`, {
      user: "u1",
      env: billingEnv(),
      body: { body: "参考" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BILLING_REQUIRED");
  });
});
