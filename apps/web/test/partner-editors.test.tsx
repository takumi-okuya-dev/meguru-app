// 編集者と担当（specs/008-team-operations contracts/ui-routes.md「編集者と担当」、US2）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Team } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTeam = vi.fn();
const getTeamInvite = vi.fn();
const rotateTeamInvite = vi.fn();
const assignEditor = vi.fn();
const unassignEditor = vi.fn();
const removeEditor = vi.fn();
const renameTeam = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { ...actual.api, getTeam, getTeamInvite, rotateTeamInvite, assignEditor, unassignEditor, removeEditor, renameTeam },
  };
});
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess, dismiss: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { PartnerEditorsPage } = await import("@/pages/partner/partner-editors");

const team: Team = {
  id: "t1",
  name: "A社",
  partnerName: "田中 健",
  editorLimit: 10,
  editors: [
    { userId: "e1", name: "佐藤 美咲", joinedAt: "2026-10-09T00:00:00.000Z", accountIds: ["b"] },
    { userId: "e2", name: "伊藤 さくら", joinedAt: "2026-10-09T00:00:00.000Z", accountIds: [] },
  ],
  accounts: [
    { id: "own", displayName: "A社 SNS運用", username: "a_sha", profilePictureUrl: null, ownerName: "田中 健", own: true },
    { id: "b", displayName: "カフェ B店", username: "cafe_b", profilePictureUrl: null, ownerName: "鈴木 花子", own: false },
  ],
  unassignedEditorCount: 1,
};

function renderPage() {
  const router = createMemoryRouter([{ path: "/", element: <PartnerEditorsPage /> }], { initialEntries: ["/"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of [getTeam, getTeamInvite, rotateTeamInvite, assignEditor, unassignEditor, removeEditor, renameTeam, toastError, toastSuccess])
    fn.mockReset();
  getTeam.mockResolvedValue(team);
  getTeamInvite.mockResolvedValue({ url: "http://localhost:5173/invite/e_" + "d".repeat(43), rotatedAt: "2026-10-09T00:00:00Z" });
});

describe("編集者と担当", () => {
  it("人数・招待リンクの行・担当の表（自社の印）・担当を決めてくださいを出す", async () => {
    renderPage();
    // PC の上部バーとスマートフォンの行の両方にある（CSS で出し分ける）
    expect((await screen.findAllByText("編集者 2/10人")).length).toBeGreaterThan(0);
    expect(screen.getByText("A社の招待リンク")).toBeInTheDocument();
    expect(screen.getByText(/あと8人/)).toBeInTheDocument();
    expect(screen.getByText("自社")).toBeInTheDocument();
    expect(screen.getByText("担当を決めてください")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "佐藤 美咲をカフェ B店の担当にする" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "伊藤 さくらをA社 SNS運用の担当にする" })).toHaveAttribute("aria-checked", "false");
  });

  it("チェックを押すとすぐ保存し、失敗したら元に戻してトーストを出す", async () => {
    assignEditor.mockResolvedValueOnce(undefined);
    unassignEditor.mockRejectedValueOnce(new ApiError("INTERNAL_ERROR", 500));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "伊藤 さくらをカフェ B店の担当にする" }));
    expect(assignEditor).toHaveBeenCalledWith("e2", "b");
    const sato = screen.getByRole("checkbox", { name: "佐藤 美咲をカフェ B店の担当にする" });
    await user.click(sato);
    expect(unassignEditor).toHaveBeenCalledWith("e1", "b");
    expect(toastError).toHaveBeenCalled();
    expect(await screen.findByRole("checkbox", { name: "佐藤 美咲をカフェ B店の担当にする" })).toHaveAttribute("aria-checked", "true");
  });

  it("「⋯」→「外す」の確認で編集者を外す", async () => {
    removeEditor.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "佐藤 美咲の操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "外す" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("佐藤 美咲さんを外しますか？");
    await user.click(within(dialog).getByRole("button", { name: "外す" }));
    expect(removeEditor).toHaveBeenCalledWith("e1");
  });

  it("「編集者を招待」でリンクとQRコード、作り直しはトースト", async () => {
    rotateTeamInvite.mockResolvedValue({ url: "http://localhost:5173/invite/e_" + "f".repeat(43), rotatedAt: "2026-10-09T01:00:00Z" });
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: "編集者を招待" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "編集者を招待" });
    expect(dialog).toHaveTextContent("参加した人は編集者になり");
    expect(await within(dialog).findByRole("img", { name: "招待リンクのQRコード" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "リンクを作り直す" }));
    expect(toastSuccess).toHaveBeenCalledWith("新しいリンクを作りました。前のリンクは使えません。");
  });
});
