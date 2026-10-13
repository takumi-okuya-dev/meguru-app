// US4：暗号鍵のローテーション（research.md R5、quickstart.md の「鍵のローテーション」）
import { beforeEach, describe, expect, it } from "vitest";
import { threadsConnections } from "../../src/db/schema";
import { createTokenCipher, KeyRingError } from "../../src/lib/crypto";
import { rotateTokenKeys } from "../../src/services/key-rotation";
import { createApp } from "../../src/app";
import { call, connectNew, createUserWithAccount, db, fake, fakeVerifier, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();
const KEY2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

describe("rotateTokenKeys", () => {
  it("旧バージョンの行を新しい鍵とIVで暗号化し直し、旧バージョンの行が0件になる", async () => {
    await connectNew(app, "u1", "1001");
    const [before] = await db().select().from(threadsConnections);
    const ring = { ...JSON.parse(testEnv.TOKEN_ENCRYPTION_KEYS), "2": KEY2 };
    const env = { ...testEnv, TOKEN_ENCRYPTION_KEYS: JSON.stringify(ring), TOKEN_ENCRYPTION_KEY_VERSION: "2" };
    const result = await rotateTokenKeys(env);
    expect(result).toEqual({ rotated: 1, skipped: 0, remainingOldVersionRows: 0 });
    const [after] = await db().select().from(threadsConnections);
    expect(after!.keyVersion).toBe(2);
    expect(Buffer.from(after!.accessTokenIv).equals(Buffer.from(before!.accessTokenIv))).toBe(false);
    const oldPlain = await createTokenCipher(testEnv.TOKEN_ENCRYPTION_KEYS, "1").decrypt(
      { ciphertext: before!.accessTokenCiphertext, iv: before!.accessTokenIv, keyVersion: 1 },
      before!.accountId,
    );
    const newPlain = await createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, "2").decrypt(
      { ciphertext: after!.accessTokenCiphertext, iv: after!.accessTokenIv, keyVersion: 2 },
      after!.accountId,
    );
    expect(newPlain).toBe(oldPlain);
  });

  it("鍵が欠けているバージョンの行があれば開始しない", async () => {
    await connectNew(app, "u1", "1001");
    const env = { ...testEnv, TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "2": KEY2 }), TOKEN_ENCRYPTION_KEY_VERSION: "2" };
    await expect(rotateTokenKeys(env)).rejects.toBeInstanceOf(KeyRingError);
    const [row] = await db().select().from(threadsConnections);
    expect(row!.keyVersion).toBe(1);
  });

  it("チームの招待リンクの暗号化した写しも入れ替え、入れ替えた後も同じリンクを表示できる（specs/011 data-model.md）", async () => {
    const { accountId } = await createUserWithAccount("a1");
    const created = await call(app, "POST", "/api/teams", { user: "a1", body: { name: "飲食チーム", accountIds: [accountId] } });
    const { teamId } = (await created.json()) as { teamId: string };
    const before = ((await (await call(app, "GET", `/api/teams/${teamId}/invite`, { user: "a1" })).json()) as { url: string }).url;
    const ring = { ...JSON.parse(testEnv.TOKEN_ENCRYPTION_KEYS), "2": KEY2 };
    const env = { ...testEnv, TOKEN_ENCRYPTION_KEYS: JSON.stringify(ring), TOKEN_ENCRYPTION_KEY_VERSION: "2" };
    expect(await rotateTokenKeys(env)).toEqual({ rotated: 1, skipped: 0, remainingOldVersionRows: 0 });
    // 旧鍵を外しても、入れ替えた写しから同じリンクを読める
    const onlyNew = createApp({ verifyAuth: () => fakeVerifier });
    const newEnv = { ...testEnv, TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "2": KEY2 }), TOKEN_ENCRYPTION_KEY_VERSION: "2" };
    const res = await onlyNew.request(`/api/teams/${teamId}/invite`, { headers: { Authorization: "Bearer test:a1" } }, newEnv);
    expect(((await res.json()) as { url: string }).url).toBe(before);
  });

  it("招待リンクに鍵が欠けているバージョンがあれば開始しない", async () => {
    const { accountId } = await createUserWithAccount("a1");
    await call(app, "POST", "/api/teams", { user: "a1", body: { name: "飲食チーム", accountIds: [accountId] } });
    const env = { ...testEnv, TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "2": KEY2 }), TOKEN_ENCRYPTION_KEY_VERSION: "2" };
    await expect(rotateTokenKeys(env)).rejects.toBeInstanceOf(KeyRingError);
  });
});
