// Threadsで許可するときのアカウントの案内（specs/025-threads-account-guide data-model.md 3、T001）
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SWITCH_ERRORS,
  THREADS_WEB_URL,
  accountGuideLead,
  accountGuideParts,
  accountSwitchSteps,
  isAccountSwitchError,
} from "../src/threads-account-guide";

describe("accountGuideParts", () => {
  it("@名前を太字にできるように分けて返し、つなぐと accountGuideLead と同じ文になる", () => {
    const parts = accountGuideParts("taku.it.ai");
    expect(parts.check).toEqual({ name: "@taku.it.ai", rest: " でログインしているか確かめてください。" });
    expect(parts.lead + parts.check!.name + parts.check!.rest).toBe(accountGuideLead("taku.it.ai"));
    expect(accountGuideParts(null).check).toBeNull();
  });
});

describe("accountGuideLead", () => {
  it("使うべきアカウントがあれば@名前を入れ、なければ前半だけ", () => {
    expect(accountGuideLead("taku.it.ai")).toBe(
      "threads.comでログインしているアカウントで許可されます。@taku.it.ai でログインしているか確かめてください。",
    );
    expect(accountGuideLead(null)).toBe("threads.comでログインしているアカウントで許可されます。");
  });
});

describe("accountSwitchSteps", () => {
  it("3行。名前がなければ「つなぎたいアカウント」、最後の行は押すボタンの名前", () => {
    expect(accountSwitchSteps("taku.it.ai", "接続し直す")).toEqual([
      "threads.com（またはThreadsのアプリ）で、今のアカウントからログアウトする",
      "@taku.it.ai でログインし直す",
      "このページに戻って、もう一度「接続し直す」を押す",
    ]);
    expect(accountSwitchSteps(null, "Threadsで許可する")[1]).toBe("つなぎたいアカウントでログインし直す");
  });
});

describe("手順を出すエラー", () => {
  it("取り違えで起きる3つだけ", () => {
    expect(ACCOUNT_SWITCH_ERRORS).toEqual(["RECONNECT_ACCOUNT_MISMATCH", "THREADS_ACCOUNT_TAKEN", "ACCOUNT_ALREADY_REGISTERED"]);
    expect(isAccountSwitchError("RECONNECT_ACCOUNT_MISMATCH")).toBe(true);
    expect(isAccountSwitchError("THREADS_AUTH_CANCELLED")).toBe(false);
    expect(isAccountSwitchError(null)).toBe(false);
    expect(THREADS_WEB_URL).toBe("https://www.threads.com/");
  });
});
