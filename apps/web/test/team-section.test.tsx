// このアカウントの設定の「運用を手伝ってもらう」（specs/008-team-operations contracts/ui-routes.md「このアカウントの設定」、US1）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountTeam } from "@threads-grower/shared";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_ACCESS, OWNER_ACCESS } from "./helpers/access";

const accountTeam = vi.fn();
const getPartnerInvite = vi.fn();
const createPartnerInvite = vi.fn();
const rotatePartnerInvite = vi.fn();
const cancelPartnerInvite = vi.fn();
const removePartner = vi.fn();
const setDelegation = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      accountTeam,
      getPartnerInvite,
      createPartnerInvite,
      rotatePartnerInvite,
      cancelPartnerInvite,
      removePartner,
      setDelegation,
    },
  };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, dismiss: vi.fn() } }));

const { TeamSection } = await import("@/components/team/TeamSection");

const URL1 = "http://localhost:5173/invite/p_" + "a".repeat(43);
const URL2 = "http://localhost:5173/invite/p_" + "b".repeat(43);

const empty: AccountTeam = { partner: null, delegation: null, editors: [], joinedNotice: { show: false } };
const joined: AccountTeam = {
  partner: { userId: "p1", name: "田中 健", teamName: "A社", joinedAt: "2026-10-09T09:00:00.000Z" },
  delegation: { review: false, settings: false },
  editors: [
    { userId: "e1", name: "佐藤 美咲" },
    { userId: "e2", name: "高橋 涼" },
  ],
  joinedNotice: { show: true },
};

function renderSection(access = OWNER_ACCESS) {
  const router = createMemoryRouter(
    [{ path: "/", element: <TeamSection accountId="a1" access={access} /> }],
    { initialEntries: ["/"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of [accountTeam, getPartnerInvite, createPartnerInvite, rotatePartnerInvite, cancelPartnerInvite, removePartner, setDelegation, toastSuccess, toastError])
    fn.mockReset();
});

describe("TeamSection（オーナー）", () => {
  it("招待なし →「招待リンクを作る」でダイアログ（リンク・コピー・QRコード・説明・作り直す）→ 閉じると招待中", async () => {
    accountTeam.mockResolvedValue(empty);
    getPartnerInvite.mockResolvedValueOnce({ invite: null }).mockResolvedValue({ invite: { url: URL1, createdAt: "2026-10-09T00:00:00Z" } });
    createPartnerInvite.mockResolvedValue({ invite: { url: URL1, createdAt: "2026-10-09T00:00:00Z" } });
    rotatePartnerInvite.mockResolvedValue({ invite: { url: URL2, createdAt: "2026-10-09T00:01:00Z" } });
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByRole("heading", { name: "運用を手伝ってもらう" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "招待リンクを作る" }));
    const dialog = await screen.findByRole("dialog", { name: "パートナーを招待" });
    expect(dialog).toHaveTextContent("運用を手伝ってもらう方に、このリンクをLINEやメールで送ってください。");
    expect(screen.getByLabelText("招待リンク")).toHaveValue(URL1);
    expect(screen.getByRole("img", { name: "招待リンクのQRコード" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("パートナーができること");
    expect(dialog).toHaveTextContent("あなただけができること");
    await user.click(screen.getByRole("button", { name: "リンクを作り直す" }));
    expect(await screen.findByDisplayValue(URL2)).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith("新しいリンクを作りました。前のリンクは使えません。");
    await user.click(screen.getAllByRole("button", { name: "閉じる" }).at(-1)!);
    expect(await screen.findByText("パートナーを招待中（参加待ち）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取り消す" })).toBeInTheDocument();
  });

  it("パートナーあり：名前・チーム名・外す、手伝っている人の一覧。外すの確認に編集者の名前が出る", async () => {
    accountTeam.mockResolvedValue(joined);
    removePartner.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByText("田中 健 · A社")).toBeInTheDocument();
    expect(screen.getByText("佐藤 美咲")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "外す" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("田中 健さん（A社）を外しますか？");
    expect(confirm).toHaveTextContent("編集者2人（佐藤 美咲・高橋 涼）");
    await user.click(screen.getAllByRole("button", { name: "外す" }).at(-1)!);
    expect(removePartner).toHaveBeenCalledWith("a1");
  });
});

describe("役割の図（FR-048）", () => {
  it("オーナーは「3つの役割と、できることを見る」で図を開け、オーナーに「あなた」の印が付く", async () => {
    accountTeam.mockResolvedValue(joined);
    const user = userEvent.setup();
    renderSection();
    const toggle = await screen.findByRole("button", { name: "3つの役割と、できることを見る" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("figure", { name: "チーム運用の役割の図" })).not.toBeInTheDocument();
    await user.click(toggle);
    const figure = screen.getByRole("figure", { name: "チーム運用の役割の図" });
    expect(within(figure).getByText("あなた").closest("li")).toHaveTextContent("オーナー");
    expect(within(figure).getByLabelText("オーナーがパートナーを招く（1アカウントに1人）")).toBeInTheDocument();
  });

  it("編集者が開くと、編集者に「あなた」の印が付く", async () => {
    accountTeam.mockResolvedValue(joined);
    const user = userEvent.setup();
    renderSection(EDITOR_ACCESS);
    await user.click(await screen.findByRole("button", { name: "3つの役割と、できることを見る" }));
    const figure = screen.getByRole("figure", { name: "チーム運用の役割の図" });
    expect(within(figure).getByText("あなた").closest("li")).toHaveTextContent("編集者");
  });
});

describe("TeamSection（パートナー・編集者）", () => {
  it("読み込みに失敗したら、区分を消さずに再読み込みを出す（PR #9 のCodexレビュー）", async () => {
    accountTeam.mockRejectedValueOnce(new Error("network")).mockResolvedValue(joined);
    const user = userEvent.setup();
    renderSection(EDITOR_ACCESS);
    expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText("このアカウントを手伝っている人")).toBeInTheDocument();
  });

  it("手伝っている人の一覧だけを出し、招待・外すは出さない", async () => {
    accountTeam.mockResolvedValue(joined);
    renderSection(EDITOR_ACCESS);
    expect(await screen.findByText("このアカウントを手伝っている人")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "外す" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "招待リンクを作る" })).not.toBeInTheDocument();
    expect(getPartnerInvite).not.toHaveBeenCalled();
  });
});

describe("任せる範囲のスイッチ（US3）", () => {
  it("初めはどちらもオフで注記が出る。切り替えるとすぐ反映し、失敗したら戻してトースト", async () => {
    accountTeam.mockResolvedValue(joined);
    setDelegation.mockResolvedValueOnce({ delegation: { review: true, settings: false } }).mockRejectedValueOnce(new Error("x"));
    const user = userEvent.setup();
    renderSection();
    const review = await screen.findByRole("switch", { name: "投稿の承認・却下をパートナーに任せる" });
    const settings = screen.getByRole("switch", { name: "設定をパートナーに任せる" });
    expect(review).toHaveAttribute("aria-checked", "false");
    expect(settings).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("編集者は、どちらもできません。Threadsとの接続・支払い・パートナーを外すことは、いつもあなただけが行えます。"),
    ).toBeInTheDocument();
    await user.click(review);
    expect(setDelegation).toHaveBeenCalledWith("a1", { review: true });
    await user.click(settings);
    expect(setDelegation).toHaveBeenCalledWith("a1", { settings: true });
    expect(toastError).toHaveBeenCalled();
  });
});
