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

describe("チームの見直しのエラー文言（specs/011 contracts/api.md）", () => {
  it("新しいコードはエラーコードとして扱え、008のコードは消えている", () => {
    for (const code of [
      "TEAM_LIMIT_REACHED",
      "TEAM_FULL",
      "TEAM_NEEDS_ACCOUNT",
      "ACCOUNT_IN_OTHER_TEAM",
      "TEAM_LAST_ACCOUNT",
      "TEAM_ADMIN_MUST_TRANSFER",
      "TEAM_ADMIN_ALONE",
    ]) {
      expect(isErrorCode(code)).toBe(true);
    }
    for (const code of ["PARTNER_ALREADY_EXISTS", "INVITE_SELF", "TEAM_EDITOR_LIMIT"]) {
      expect(isErrorCode(code)).toBe(false);
    }
  });

  it("文言", () => {
    expect(errorMessage("TEAM_LIMIT_REACHED").message).toBe("1人が管理者になれるチームは20までです。");
    expect(errorMessage("TEAM_FULL").message).toContain("上限（50人）");
    expect(errorMessage("TEAM_FULL", { details: ["editors"] }).message).toBe("編集者が上限（10人）に達しています。");
    expect(errorMessage("TEAM_NEEDS_ACCOUNT").message).toContain("1つ以上選んでください");
    expect(errorMessage("ACCOUNT_IN_OTHER_TEAM").message).toContain("ほかのチームに入っています");
    expect(errorMessage("TEAM_LAST_ACCOUNT").message).toContain("「チームを抜ける」");
    expect(errorMessage("TEAM_ADMIN_MUST_TRANSFER").message).toContain("管理者を引き継ぐ人を選んでください");
    expect(errorMessage("TEAM_ADMIN_ALONE").message).toContain("チームを削除してください");
    expect(errorMessage("INVITE_INVALID").message).toContain("このリンクは使えません");
  });
});

describe("アカウントを先に作るのエラー文言（specs/012 contracts/api.md）", () => {
  it("新しいコードはエラーコードとして扱える", () => {
    for (const code of ["ACCOUNT_NOT_CONNECTED", "ACCOUNT_ALREADY_CONNECTED"]) expect(isErrorCode(code)).toBe(true);
  });

  it("文言", () => {
    expect(errorMessage("ACCOUNT_NOT_CONNECTED").message).toBe(
      "このアカウントは、まだThreadsにつながっていません。「このアカウントの設定」からつないでください。",
    );
    expect(errorMessage("ACCOUNT_ALREADY_CONNECTED").message).toBe("このアカウントは、すでにThreadsにつながっています。");
  });

  it("自分の別のアカウントと重なったら、そのアカウントの名前を出す（details: [id, name, username]）", () => {
    expect(errorMessage("ACCOUNT_ALREADY_REGISTERED", { details: ["a1", "カフェ", "cafe_b"] }).message).toBe(
      "@cafe_bは、あなたのアカウント『カフェ』につながっています。",
    );
    // 名前がなければ今の文言
    expect(errorMessage("ACCOUNT_ALREADY_REGISTERED").message).toContain("「接続し直す」");
  });

  it("未接続で自動投稿をオンにしようとしたとき", () => {
    expect(errorMessage("THREADS_NOT_READY", { details: ["not_connected"] }).message).toBe("Threadsにつなぐと使えます");
  });
});
