// トークンでの接続のエラー文言（specs/010-token-account-add contracts/api.md「文言」）
import { describe, expect, it } from "vitest";
import { errorMessage, isErrorCode } from "../src/errors";

describe("トークンでの接続のエラー文言", () => {
  it("新しいコードはエラーコードとして扱える", () => {
    for (const code of ["TOKEN_INVALID", "TOKEN_SHORT_LIVED", "TOKEN_CHECK_LOCKED", "ACCOUNT_ALREADY_REGISTERED", "THREADS_UNAVAILABLE"]) {
      expect(isErrorCode(code)).toBe(true);
    }
  });

  it("文言", () => {
    expect(errorMessage("TOKEN_INVALID").message).toBe("トークンを確かめられませんでした。トークンを作り直して貼り付けてください。");
    expect(errorMessage("TOKEN_SHORT_LIVED").message).toContain("長期トークンを貼り付けてください");
    expect(errorMessage("ACCOUNT_ALREADY_REGISTERED").message).toContain("「接続し直す」");
    expect(errorMessage("THREADS_UNAVAILABLE").message).toContain("時間をおいて");
  });

  it("待ちの残りの分を差し込む（1分未満は1分）", () => {
    expect(errorMessage("TOKEN_CHECK_LOCKED", { minutes: 7 }).message).toBe("しばらく待ってから、もう一度お試しください（あと7分）。");
    expect(errorMessage("TOKEN_CHECK_LOCKED", { minutes: 0 }).message).toContain("あと1分");
  });

  it("接続し直しで別のアカウント：トークンのときはトークン用の文", () => {
    expect(errorMessage("RECONNECT_ACCOUNT_MISMATCH", { username: "cafe_b", method: "token" }).message).toBe(
      "別のThreadsアカウントのトークンです。@cafe_bのトークンを貼り付けてください。",
    );
    expect(errorMessage("RECONNECT_ACCOUNT_MISMATCH", { username: "cafe_b" }).message).toContain("認可してください");
  });
});
