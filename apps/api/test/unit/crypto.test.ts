import { describe, expect, it } from "vitest";
import { KeyRingError, createTokenCipher } from "../../src/lib/crypto";

const KEY1 = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const KEY2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";

describe("トークンの暗号化（research.md R5）", () => {
  it("同じ平文を同じ鍵で2回暗号化すると、IVも暗号文も異なる（IVの一意性）", async () => {
    const cipher = createTokenCipher(JSON.stringify({ "1": KEY1 }), "1");
    const a = await cipher.encrypt("token-abc", ACCOUNT_A);
    const b = await cipher.encrypt("token-abc", ACCOUNT_A);
    expect(a.iv).toHaveLength(12);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
    expect(await cipher.decrypt(a, ACCOUNT_A)).toBe("token-abc");
  });

  it("AADに別の account_id を使うと復号に失敗する（暗号文の付け替え）", async () => {
    const cipher = createTokenCipher(JSON.stringify({ "1": KEY1 }), "1");
    const enc = await cipher.encrypt("token-abc", ACCOUNT_A);
    await expect(cipher.decrypt(enc, ACCOUNT_B)).rejects.toThrow();
  });

  it("鍵リングに旧バージョンの鍵があれば旧暗号文を復号でき、新規の暗号化は新しい鍵になる", async () => {
    const old = createTokenCipher(JSON.stringify({ "1": KEY1 }), "1");
    const enc1 = await old.encrypt("token-old", ACCOUNT_A);
    const rotated = createTokenCipher(JSON.stringify({ "1": KEY1, "2": KEY2 }), "2");
    expect(await rotated.decrypt(enc1, ACCOUNT_A)).toBe("token-old");
    const enc2 = await rotated.encrypt("token-new", ACCOUNT_A);
    expect(enc2.keyVersion).toBe(2);
  });

  it("鍵が欠けたバージョンの暗号文はエラーになる", async () => {
    const old = createTokenCipher(JSON.stringify({ "1": KEY1 }), "1");
    const enc1 = await old.encrypt("token-old", ACCOUNT_A);
    const onlyNew = createTokenCipher(JSON.stringify({ "2": KEY2 }), "2");
    await expect(onlyNew.decrypt(enc1, ACCOUNT_A)).rejects.toBeInstanceOf(KeyRingError);
  });

  it("現在のバージョンの鍵が鍵リングにない設定は、作成時の検証で失敗する", () => {
    expect(() => createTokenCipher(JSON.stringify({ "1": KEY1 }), "2")).toThrow(KeyRingError);
  });

  it("32バイトでない鍵は検証で失敗する", () => {
    const short = btoa("short");
    expect(() => createTokenCipher(JSON.stringify({ "1": short }), "1")).toThrow(KeyRingError);
  });
});
