// アカウントの示し方（specs/012 research.md R2、contracts/ui-routes.md「アカウントの示し方」）
import { describe, expect, it } from "vitest";
import { accountLabel } from "../src/account-label";

describe("accountLabel", () => {
  it("未接続：主の名前はアカウントの名前、添える名前なし、未接続の印", () => {
    expect(accountLabel({ name: "カフェの公式", username: null, connectionStatus: "not_connected" })).toEqual({
      primary: "カフェの公式",
      secondary: null,
      initial: "カ",
      notConnected: true,
    });
  });

  it("接続中：主の名前はアカウントの名前のまま、@ユーザー名を添える", () => {
    expect(accountLabel({ name: "cafe owner", username: "cafe_b", connectionStatus: "connected" })).toEqual({
      primary: "cafe owner",
      secondary: "@cafe_b",
      initial: "C",
      notConnected: false,
    });
  });

  it("要再接続も@ユーザー名を添える。状態がなければ接続中として扱う", () => {
    expect(accountLabel({ name: "B", username: "b", connectionStatus: "needs_reconnect" }).secondary).toBe("@b");
    expect(accountLabel({ name: "B", username: "b" }).notConnected).toBe(false);
  });

  it("頭文字はサロゲートペアを分けない", () => {
    expect(accountLabel({ name: "𠮷野家", username: null, connectionStatus: "not_connected" }).initial).toBe("𠮷");
  });
});
