// 役割と権限の読み込み・権限のエラーの扱い（specs/008-team-operations contracts/ui-routes.md「共通の振る舞い」2・3）
import { QueryClient } from "@tanstack/react-query";
import type { AccountAccessResponse } from "@threads-grower/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), dismiss: vi.fn() } }));

const { canDo, makeAccountAccessErrorHandler } = await import("@/lib/use-account-access");
const { queryKeys } = await import("@/lib/query");

const ID = "11111111-1111-4111-8111-111111111111";

const editor: AccountAccessResponse = {
  role: "editor",
  permissions: ["view", "content"],
  owner: { name: "鈴木 花子" },
  hasTeam: true,
  team: { name: "A社", partnerName: "田中 健" },
  delegation: { review: false, settings: false },
};

beforeEach(() => {
  toastError.mockReset();
});

describe("canDo", () => {
  it("権限の一覧にあるものだけ true。読み込み前はすべて false", () => {
    expect(canDo(editor, "content")).toBe(true);
    expect(canDo(editor, "review")).toBe(false);
    expect(canDo(undefined, "view")).toBe(false);
  });
});

describe("makeAccountAccessErrorHandler", () => {
  function setup() {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const navigate = vi.fn();
    const handle = makeAccountAccessErrorHandler({ accountId: ID, queryClient, navigate });
    return { invalidate, navigate, handle };
  }

  it("ROLE_FORBIDDEN：表示中のAccountのデータ（役割を含む）を読み直す。画面は移らない", () => {
    const { invalidate, navigate, handle } = setup();
    handle("ROLE_FORBIDDEN", ID);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.account(ID) });
    expect(navigate).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("ACCOUNT_NOT_FOUND：「このアカウントを開けなくなりました」と出して / へ移る", () => {
    const { invalidate, navigate, handle } = setup();
    handle("ACCOUNT_NOT_FOUND", ID);
    expect(toastError).toHaveBeenCalledWith("このアカウントを開けなくなりました", { id: "account-access-lost" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.me });
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("別のAccountのエラーは扱わない", () => {
    const { navigate, handle } = setup();
    handle("ACCOUNT_NOT_FOUND", "22222222-2222-4222-8222-222222222222");
    expect(navigate).not.toHaveBeenCalled();
  });
});
