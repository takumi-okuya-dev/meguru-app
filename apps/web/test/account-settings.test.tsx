// このアカウントの設定の「投稿のルール」（specs/004-review-approval FR-014・FR-019〜FR-021・FR-031・FR-042、contracts/ui-routes.md）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountSummary, NgWord, PostingRules } from "@threads-grower/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPostingRules = vi.fn();
const addNgWords = vi.fn();
const deleteNgWord = vi.fn();
const putCoreRules = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, getPostingRules, addNgWords, deleteNgWord, putCoreRules } };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, dismiss: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { AccountSettings } = await import("@/pages/account-settings");

const account: AccountSummary = {
  id: "a1",
  username: "takumi",
  displayName: "たくみ",
  profilePictureUrl: null,
  plan: "auto-grower",
  connectionStatus: "connected",
  lastUsedAt: null,
};

const word = (id: string, w: string): NgWord => ({ id, word: w, normalized: w, createdAt: "2026-10-04T00:00:00.000Z" });

function rules(overrides: Partial<PostingRules> = {}): PostingRules {
  return { ngWords: [], ngWordLimit: 200, coreRules: "", coreRulesVersion: 1, canEditCoreRules: true, ...overrides };
}

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: (
          <UnsavedChangesProvider>
            <Outlet context={{ account }} />
          </UnsavedChangesProvider>
        ),
        children: [{ path: "settings", element: <AccountSettings /> }],
      },
    ],
    { initialEntries: ["/accounts/a1/settings"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of [getPostingRules, addNgWords, deleteNgWord, putCoreRules, toastSuccess, toastError]) fn.mockReset();
  getPostingRules.mockResolvedValue(rules({ ngWords: [word("w1", "絶対")] }));
});

describe("「投稿のルール」の区分（FR-031）", () => {
  it("「Threadsとの接続」より上にあり、NGワードの行に語数と「編集」がある", async () => {
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のルール" });
    const heading = screen.getByRole("heading", { name: "Threadsとの接続" });
    expect(section.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(section).findByText("この言葉を含む下書きは承認できません。1語")).toBeInTheDocument();
  });
});

describe("NGワードのダイアログ（FR-014・FR-016a）", () => {
  async function openDialog() {
    const user = userEvent.setup();
    renderPage();
    const section = await screen.findByRole("region", { name: "投稿のルール" });
    await waitFor(() => expect(within(section).getAllByRole("button", { name: "編集" })[0]).toBeEnabled());
    await user.click(within(section).getAllByRole("button", { name: "編集" })[0]!);
    return { user, dialog: await screen.findByRole("dialog", { name: "NGワード" }) };
  }

  it("「、」「,」・改行で区切って一度に追加できる。Enterでも追加する", async () => {
    addNgWords.mockResolvedValue({ added: [], duplicates: [], reopenedCount: 0 });
    const { user, dialog } = await openDialog();
    const input = within(dialog).getByRole("textbox", { name: "追加するNGワード" });
    await user.type(input, "絶対、必ず儲かる,神");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(addNgWords).toHaveBeenCalledWith("a1", ["絶対", "必ず儲かる", "神"]);
    await user.type(input, "最強{Enter}");
    expect(addNgWords).toHaveBeenLastCalledWith("a1", ["最強"]);
  });

  it("重複は「すでにあります」、承認済みを戻したらトーストで知らせる", async () => {
    addNgWords.mockResolvedValue({ added: [word("w2", "神")], duplicates: ["絶対"], reopenedCount: 2 });
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: "追加するNGワード" }), "絶対、神");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(await within(dialog).findByText("「絶対」はすでにあります")).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith("NGワードを含む承認済みの下書き2件を、要確認に戻しました");
  });

  it("チップの×で削除し、トーストの「元に戻す」で足し直す", async () => {
    deleteNgWord.mockResolvedValue(null);
    addNgWords.mockResolvedValue({ added: [word("w3", "絶対")], duplicates: [], reopenedCount: 0 });
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "絶対を削除" }));
    expect(deleteNgWord).toHaveBeenCalledWith("a1", "w1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("「絶対」を削除しました", expect.anything()));
    const undo = toastSuccess.mock.calls.at(-1)![1].action.onClick as () => void;
    await act(async () => undo());
    expect(addNgWords).toHaveBeenCalledWith("a1", ["絶対"]);
  });

  it("200語に達したら入力欄が無効になり、案内が出る", async () => {
    getPostingRules.mockResolvedValue(rules({ ngWords: Array.from({ length: 200 }, (_, i) => word(`w${i}`, `語${i}`)) }));
    const { dialog } = await openDialog();
    expect(within(dialog).getByRole("textbox", { name: "追加するNGワード" })).toBeDisabled();
    expect(within(dialog).getByText("上限（200語）に達しています")).toBeInTheDocument();
  });

  it("上限の 409 は案内を出す", async () => {
    addNgWords.mockRejectedValue(new ApiError("ITEM_LIMIT_REACHED", 409));
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: "追加するNGワード" }), "新しい語");
    await user.click(within(dialog).getByRole("button", { name: "追加" }));
    expect(await within(dialog).findByText("NGワードは200語まで登録できます。")).toBeInTheDocument();
  });
});
