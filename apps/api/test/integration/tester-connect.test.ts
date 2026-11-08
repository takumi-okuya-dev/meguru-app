// US1：接続・アカウントの削除・退会で申し込みを進める（specs/024-tester-invite-connect research.md R5・R15、data-model.md 5、T011）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_APP_SECRET } from "../env";
import { call, connectExisting, fake, makeApp, resetDb, testEnv } from "../helpers/app";
import { makeSignedRequest } from "../helpers/signed-request";
import {
  applicationRow,
  applicationsOf,
  applyFor,
  markInvited,
  operatorEventRows,
  resetOperatorSettings,
  unconnectedAccountOf,
} from "../helpers/tester-invites";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);

beforeEach(async () => {
  await resetDb();
  await resetOperatorSettings();
  await fake.reset();
  await fake.addUser("9001", "Shop_Tokyo", "Shop Tokyo");
  await fake.addUser("9002", "other_shop", "Other");
});

/**
 * つなぐ前のアカウントで申し込む。
 * @returns アカウントと申し込みのID
 */
async function applied(user: string, username: string, opts: { invited?: boolean } = {}) {
  const accountId = await unconnectedAccountOf(app, user);
  const { id } = (await (await applyFor(app, user, accountId, username)).json()) as { id: string };
  if (opts.invited) await markInvited(id);
  return { accountId, id };
}

describe("Threadsで許可する（OAuth）でつながったとき", () => {
  it("招待済みで、ユーザー名が同じ（大文字・小文字は問わない）なら接続済み", async () => {
    const { accountId, id } = await applied("u1", "shop_tokyo", { invited: true });
    const { callbackRes } = await connectExisting(app, "u1", accountId, "9001");
    expect(callbackRes?.status).toBe(302);
    expect(await applicationRow(id)).toMatchObject({
      status: "connected",
      holds_slot: true,
      removal_reason: null,
      connected_username: "shop_tokyo",
    });
  });

  it("申し込み中のままつながった（すでにテスターだった）ときも接続済みにし、枠を使う", async () => {
    const { accountId, id } = await applied("u1", "shop_tokyo");
    await connectExisting(app, "u1", accountId, "9001");
    expect(await applicationRow(id)).toMatchObject({ status: "connected", holds_slot: true });
  });

  it("ユーザー名が違えば、取り下げ（username_mismatch）で外してよい", async () => {
    const { accountId, id } = await applied("u1", "shop_tokyo", { invited: true });
    await connectExisting(app, "u1", accountId, "9002");
    expect(await applicationRow(id)).toMatchObject({
      status: "withdrawn",
      removal_reason: "username_mismatch",
      holds_slot: true,
      connected_username: "other_shop",
    });
  });

  it("接続の確定が失敗したら、申し込みも変わらない（同じトランザクション）", async () => {
    const { accountId, id } = await applied("u1", "shop_tokyo", { invited: true });
    await fake.fail("getProfile", 1, "server");
    await connectExisting(app, "u1", accountId, "9001");
    expect(await applicationRow(id)).toMatchObject({ status: "invited", holds_slot: true });
  });
});

describe("トークンでつながったとき", () => {
  it("招待済みは取り下げ（token_connected）で外してよい、申し込み中は理由なしの取り下げ", async () => {
    const a = await applied("u1", "shop_tokyo", { invited: true });
    const b = await applied("u2", "other_shop");
    for (const [user, acc, threadsUser] of [
      ["u1", a.accountId, "9001"],
      ["u2", b.accountId, "9002"],
    ] as const) {
      const token = await fake.issueToken({ user: threadsUser });
      const res = await call(app, "POST", "/api/threads/token-connect", { user, body: { mode: "connect", accountId: acc, token } });
      expect(res.status).toBe(200);
    }
    expect(await applicationRow(a.id)).toMatchObject({ status: "withdrawn", removal_reason: "token_connected", holds_slot: true });
    expect(await applicationRow(b.id)).toMatchObject({ status: "withdrawn", removal_reason: null, holds_slot: false });
  });
});

describe("アカウントを消したとき", () => {
  it("接続済みは取り下げ（account_deleted）で外してよい。行は残り、account_id は空になる", async () => {
    const { accountId, id } = await applied("u1", "shop_tokyo", { invited: true });
    await connectExisting(app, "u1", accountId, "9001");
    const [acc] = (await q()`SELECT name FROM accounts WHERE id = ${accountId}`) as { name: string }[];
    const res = await call(app, "DELETE", `/api/accounts/${accountId}`, { user: "u1", body: { confirmName: acc!.name } });
    expect(res.status).toBe(204);
    expect(await applicationRow(id)).toMatchObject({
      status: "withdrawn",
      removal_reason: "account_deleted",
      holds_slot: true,
      account_id: null,
    });
  });
});

describe("Metaからのデータ削除でアカウントが消えたとき（PR #71 のCodexレビュー）", () => {
  it("接続済みは取り下げ（account_deleted）で外してよい", async () => {
    const { accountId, id } = await applied("u1", "shop_tokyo", { invited: true });
    await connectExisting(app, "u1", accountId, "9001");
    const res = await call(app, "POST", "/api/threads/webhooks/data-deletion", {
      body: new URLSearchParams({ signed_request: await makeSignedRequest(TEST_APP_SECRET, { user_id: "9001", issued_at: 1 }) }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(200);
    expect(await applicationRow(id)).toMatchObject({ status: "withdrawn", removal_reason: "account_deleted", holds_slot: true, account_id: null });
  });
});

describe("退会したとき（research.md R15）", () => {
  it("枠を使っていない行は消え、枠を使っている行はユーザー名だけを残して外してよい。記録に個人の情報がない", async () => {
    await q()`UPDATE operator_settings SET default_account_limit = 10`; // アカウントを4件作る
    const pending = await applied("u1", "pending_one");
    const declined = await applied("u1", "declined_one");
    await q()`UPDATE tester_applications SET status = 'declined', decline_reason = '見送り' WHERE id = ${declined.id}`;
    const invited = await applied("u1", "shop_tokyo", { invited: true });
    await connectExisting(app, "u1", invited.accountId, "9001");
    // 違うアカウントでつながった申し込み（connected_username が入る）も、退会でそのユーザー名を残さない
    const mismatch = await applied("u1", "wanted_name", { invited: true });
    await connectExisting(app, "u1", mismatch.accountId, "9002");

    const res = await call(app, "POST", "/api/me/withdraw", { user: "u1", body: { confirmEmail: "u1@example.com" } });
    expect(res.status).toBe(204);

    expect(await applicationRow(pending.id)).toBeUndefined();
    expect(await applicationRow(declined.id)).toBeUndefined();
    expect(await applicationRow(invited.id)).toMatchObject({
      status: "withdrawn",
      removal_reason: "user_withdrawn",
      holds_slot: true,
      user_id: null,
      account_id: null,
      threads_username: "shop_tokyo",
    });
    for (const e of await operatorEventRows()) {
      expect(e.actor_user_id).toBeNull();
      const detail = JSON.stringify(e.detail ?? null);
      for (const word of ["shop_tokyo", "pending_one", "u1@example.com"]) expect(detail).not.toContain(word);
    }
    expect(await applicationRow(mismatch.id)).toMatchObject({ removal_reason: "username_mismatch", connected_username: null });
    expect(await applicationsOf(invited.accountId)).toEqual([]);
  });
});
