// 運営者のアカウント一覧の定数とスキーマ（specs/026-operator-accounts data-model.md 4、contracts/api.md、T001・T002）
import { describe, expect, it } from "vitest";
import {
  CONNECTION_STATUS_LABELS,
  OPERATOR_ACCOUNTS_PAGE_SIZE,
  OPERATOR_ACCOUNTS_QUERY_MAX,
  OPERATOR_ACCOUNT_METHOD_LABELS,
  OPERATOR_ACCOUNT_TESTER_LABELS,
  operatorAccountsQuerySchema,
  operatorAccountsSchema,
} from "../src";

describe("表示名", () => {
  it("接続方法・接続の状態・テスター招待の状態", () => {
    expect(OPERATOR_ACCOUNT_METHOD_LABELS).toEqual({ all: "すべて", app: "Threadsで許可する", token: "トークン", none: "つなぐ前" });
    expect(CONNECTION_STATUS_LABELS).toEqual({ connected: "接続中", needs_reconnect: "要再接続", not_connected: "つなぐ前" });
    expect(OPERATOR_ACCOUNT_TESTER_LABELS).toEqual({ pending: "申し込み中", invited: "招待済み", connected: "接続済み", removable: "外してよい" });
    expect(OPERATOR_ACCOUNTS_PAGE_SIZE).toBe(50);
    expect(OPERATOR_ACCOUNTS_QUERY_MAX).toBe(100);
  });
});

describe("operatorAccountsQuerySchema", () => {
  it("既定は method=all、q は前後の空白を除き、空なら無し", () => {
    expect(operatorAccountsQuerySchema.parse({})).toEqual({ method: "all" });
    expect(operatorAccountsQuerySchema.parse({ method: "token", q: "  taku " })).toEqual({ method: "token", q: "taku" });
    expect(operatorAccountsQuerySchema.parse({ q: "   " })).toEqual({ method: "all" });
  });

  it("合わない method・101文字の q・形の違う cursor は通さない", () => {
    expect(operatorAccountsQuerySchema.safeParse({ method: "other" }).success).toBe(false);
    expect(operatorAccountsQuerySchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
    expect(operatorAccountsQuerySchema.safeParse({ q: "a".repeat(100) }).success).toBe(true);
    expect(operatorAccountsQuerySchema.safeParse({ cursor: "x" }).success).toBe(false);
    expect(operatorAccountsQuerySchema.safeParse({ cursor: "3f2b8c1e-8a3b-4c1d-9e2f-1a2b3c4d5e6f" }).success).toBe(false);
    expect(
      operatorAccountsQuerySchema.safeParse({ cursor: "2026-11-09T01:02:03.123456Z_3f2b8c1e-8a3b-4c1d-9e2f-1a2b3c4d5e6f" }).success,
    ).toBe(true);
  });
});

describe("operatorAccountsSchema", () => {
  it("件数・行・続きの印を読む", () => {
    const parsed = operatorAccountsSchema.parse({
      counts: { all: 1, app: 1, token: 0, none: 0 },
      items: [
        {
          id: "a1",
          name: "AI部",
          username: "taku.it.ai",
          method: "app",
          status: "connected",
          owner: { name: "山田", email: "t@example.com", accountCount: 2 },
          tester: "connected",
          createdAt: "2026-11-09T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    expect(parsed.items[0]!.owner!.accountCount).toBe(2);
  });
});
