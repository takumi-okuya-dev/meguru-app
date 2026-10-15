// US1：課題（specs/002-strategy-profile FR-001〜FR-006・FR-020・FR-021・FR-023〜FR-025、research.md R1〜R3・R14）
import { emptyStrategyValues } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, makeApp, resetDb, setAccount } from "../helpers/app";
import { putInTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const path = (accountId: string) => `/api/accounts/${accountId}/strategy`;

function fullValues() {
  const v = emptyStrategyValues();
  for (const k of Object.keys(v) as (keyof typeof v)[]) {
    if (k !== "tonePreset") (v as Record<string, string | null>)[k] = `${k}の内容`;
  }
  v.tonePreset = "polite_warm";
  return v;
}

async function getStrategy(accountId: string, user = "u1") {
  const res = await call(app, "GET", path(accountId), { user });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown> & { version: number; filledCount: number; canEdit: boolean };
}

describe("GET・PUT /api/accounts/:id/strategy", () => {
  it("保存前は全項目が空・version 0・updatedAt null で返る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const s = await getStrategy(accountId);
    expect(s.version).toBe(0);
    expect(s.updatedAt).toBeNull();
    expect(s.finalAction).toBe("");
    expect(s.tonePreset).toBeNull();
    expect(s.filledCount).toBe(0);
    expect(s.totalCount).toBe(16);
    expect(s.canEdit).toBe(true);
  });

  it("課題の復元：保存した全20項目と近い人間性が、同じ値で返る（SC-003）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const values = fullValues();
    const put = await call(app, "PUT", path(accountId), { user: "u1", body: { ...values, expectedVersion: 0 } });
    expect(put.status).toBe(200);
    const saved = (await put.json()) as { version: number; updatedAt: string };
    expect(saved.version).toBe(1);
    expect(saved.updatedAt).not.toBeNull();
    const s = await getStrategy(accountId);
    for (const [k, v] of Object.entries(values)) expect(s[k]).toEqual(v);
    expect(s.filledCount).toBe(16);
  });

  it("空欄の扱い：空白・改行だけの項目は \"\" で返り、入力済み項目数に数えない。下書きは数えない（FR-004・FR-005）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const values = emptyStrategyValues();
    values.finalAction = "  \n ";
    values.realWorries = "  本音の悩み  ";
    values.profileBioDraft = "プロフィール文";
    const res = await call(app, "PUT", path(accountId), { user: "u1", body: { ...values, expectedVersion: 0 } });
    expect(res.status).toBe(200);
    const s = await getStrategy(accountId);
    expect(s.finalAction).toBe("");
    expect(s.realWorries).toBe("  本音の悩み  ");
    expect(s.filledCount).toBe(1);
  });

  it("文字数の上限：2,000文字ちょうどは保存でき、2,001文字は 400 で details に項目名。絵文字1つは1文字", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const ok = { ...emptyStrategyValues(), finalAction: "😀".repeat(2000), expectedVersion: 0 };
    expect((await call(app, "PUT", path(accountId), { user: "u1", body: ok })).status).toBe(200);
    const ng = { ...emptyStrategyValues(), finalAction: "a".repeat(2001), toneNotes: "b".repeat(2001), expectedVersion: 1 };
    const res = await call(app, "PUT", path(accountId), { user: "u1", body: ng });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: string[] } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toEqual(expect.arrayContaining(["finalAction", "toneNotes"]));
  });

  it("キーの不足と、近い人間性の値の誤りは 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { finalAction: _omit, ...missing } = emptyStrategyValues();
    expect((await call(app, "PUT", path(accountId), { user: "u1", body: { ...missing, expectedVersion: 0 } })).status).toBe(400);
    const bad = { ...emptyStrategyValues(), tonePreset: "angry", expectedVersion: 0 };
    expect((await call(app, "PUT", path(accountId), { user: "u1", body: bad })).status).toBe(400);
  });

  describe("課題の競合（FR-020、research.md R3）", () => {
    it("同じ expectedVersion で2回保存すると、2回目は 409 で latest に1回目の値。latest.version で保存し直すと成功する", async () => {
      const { accountId } = await createUserWithAccount("u1");
      const first = { ...emptyStrategyValues(), finalAction: "タブA", expectedVersion: 0 };
      expect((await call(app, "PUT", path(accountId), { user: "u1", body: first })).status).toBe(200);
      const second = { ...emptyStrategyValues(), finalAction: "タブB", expectedVersion: 0 };
      const res = await call(app, "PUT", path(accountId), { user: "u1", body: second });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string }; latest: { finalAction: string; version: number } };
      expect(body.error.code).toBe("STALE_UPDATE");
      expect(body.latest.finalAction).toBe("タブA");
      expect(body.latest.version).toBe(1);
      // GET と同じ形（canEdit を含む）で返す
      expect((body.latest as unknown as { canEdit: boolean }).canEdit).toBe(true);
      const retry = await call(app, "PUT", path(accountId), {
        user: "u1",
        body: { ...second, expectedVersion: body.latest.version },
      });
      expect(retry.status).toBe(200);
      expect((await getStrategy(accountId)).finalAction).toBe("タブB");
    });

    it("行がない状態で2つのタブが expectedVersion 0 で同時に保存しても、成功は1つだけ", async () => {
      const { accountId } = await createUserWithAccount("u1");
      const results = await Promise.all(
        ["A", "B"].map((t) =>
          call(app, "PUT", path(accountId), { user: "u1", body: { ...emptyStrategyValues(), finalAction: t, expectedVersion: 0 } }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it("行がないのに expectedVersion 1 で保存すると 409 で、行は作られない", async () => {
      const { accountId } = await createUserWithAccount("u1");
      const res = await call(app, "PUT", path(accountId), {
        user: "u1",
        body: { ...emptyStrategyValues(), finalAction: "x", expectedVersion: 1 },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { latest: { version: number; finalAction: string } };
      expect(body.latest.version).toBe(0);
      expect(body.latest.finalAction).toBe("");
      expect((await getStrategy(accountId)).version).toBe(0);
    });
  });

  it("他人のAccount：GET も PUT も 404 ACCOUNT_NOT_FOUND で、相手のデータは変わらない（FR-023、SC-006）", async () => {
    const { accountId } = await createUserWithAccount("owner");
    await call(app, "PUT", path(accountId), {
      user: "owner",
      body: { ...emptyStrategyValues(), finalAction: "持ち主の内容", expectedVersion: 0 },
    });
    await createUserWithAccount("other");
    const get = await call(app, "GET", path(accountId), { user: "other" });
    expect(get.status).toBe(404);
    expect(((await get.json()) as { error: { code: string } }).error.code).toBe("ACCOUNT_NOT_FOUND");
    const put = await call(app, "PUT", path(accountId), {
      user: "other",
      body: { ...emptyStrategyValues(), finalAction: "乗っ取り", expectedVersion: 1 },
    });
    expect(put.status).toBe(404);
    expect((await getStrategy(accountId, "owner")).finalAction).toBe("持ち主の内容");
  });

  it("要再接続のAccountでも、読み書きできる（FR-025）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await setAccount(accountId, { connectionStatus: "needs_reconnect" });
    const res = await call(app, "PUT", path(accountId), {
      user: "u1",
      body: { ...emptyStrategyValues(), finalAction: "x", expectedVersion: 0 },
    });
    expect(res.status).toBe(200);
  });

  describe("無料体験の前後（決済OFF。読むだけは specs/013 read-only-access.test.ts）", () => {
    it("無料体験中と、無料体験の後（決済OFF）は保存できる", async () => {
      const a = await createUserWithAccount("trial");
      const b = await createUserWithAccount("paid", { userCreatedAt: AFTER_TRIAL() });
      for (const [user, { accountId }] of [["trial", a], ["paid", b]] as const) {
        const res = await call(app, "PUT", path(accountId), {
          user,
          body: { ...emptyStrategyValues(), finalAction: "x", expectedVersion: 0 },
        });
        expect(res.status).toBe(200);
      }
    });

  });
});

// ---- チーム運用：grower機能はオーナーの登録日時で判定する（specs/008 research.md R3）----
describe("使える状態はオーナーで判定する（チーム運用。specs/008 research.md R3）", () => {
  it("無料体験の終わった編集者でも、無料体験中のオーナーのAccountは編集できる", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { editor: "e1", editorCreatedAt: AFTER_TRIAL() });
    const res = await call(app, "PUT", path(accountId), {
      user: "e1",
      body: { ...fullValues(), expectedVersion: 0 },
    });
    expect(res.status).toBe(200);
  });

});
