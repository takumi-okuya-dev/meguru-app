// US8：解説がまだの参考投稿を、まとめてAIに解説してもらう（specs/014-strategy-guidance FR-086・FR-100〜FR-105）
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refPost, renderResearchPage } from "./helpers/research";

const listReferencePosts = vi.fn();
const listResearchKeywords = vi.fn();
const getExplainPrompt = vi.fn();
const saveExplanations = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, listReferencePosts, listResearchKeywords, getExplainPrompt, saveExplanations } };
});
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const { ResearchPage } = await import("@/pages/research");

const A = refPost({ id: "aaaaaaaa-0000-4000-8000-000000000001", shortId: "aaaaaaaa", body: "空の投稿A" });
const B = refPost({ id: "bbbbbbbb-0000-4000-8000-000000000002", shortId: "bbbbbbbb", body: "空の投稿B" });
const C = refPost({ id: "cccccccc-0000-4000-8000-000000000003", shortId: "cccccccc", body: "解説ありの投稿C", whyGood: "前の解説" });

beforeEach(() => {
  listReferencePosts.mockReset().mockResolvedValue({ items: [A, B, C], limit: 200, canEdit: true });
  listResearchKeywords.mockReset().mockResolvedValue({ items: [], limit: 100, canEdit: true });
  getExplainPrompt.mockReset().mockResolvedValue({
    prompt: "まとめての解説のプロンプト",
    items: [
      { id: A.id, shortId: "aaaaaaaa" },
      { id: B.id, shortId: "bbbbbbbb" },
    ],
    pendingCount: 2,
  });
  saveExplanations.mockReset();
  toastSuccess.mockReset();
});

function panel() {
  return within(screen.getByRole("region", { name: "まとめてAIに解説してもらう" }));
}

describe("まとめてAIに解説してもらう", () => {
  it("解説がまだの件数と、押すとプロンプトをコピーして貼り付け欄が出る（US8-1・US8-2）", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderResearchPage(ResearchPage);
    expect(await screen.findByText("解説がまだの参考投稿：2件")).toBeInTheDocument();
    await user.click(panel().getByRole("button", { name: "まとめてAIに解説してもらう（2件）" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("まとめての解説のプロンプト"));
    expect(getExplainPrompt).toHaveBeenCalledWith("a1", undefined);
    expect(panel().getByLabelText("AIの答えを貼り付ける")).toBeInTheDocument();
  });

  it("プロンプトを読み込めなければ、原因を出してもう一度押せる（PR #17 のCodexレビュー）", async () => {
    const { ApiError } = await import("@/lib/api-client");
    getExplainPrompt.mockRejectedValueOnce(new ApiError("API_UNREACHABLE", 0));
    renderResearchPage(ResearchPage);
    const button = await screen.findByRole("button", { name: /まとめてAIに解説してもらう（/ });
    await userEvent.click(button);
    expect(await screen.findByText(/^プロンプトを作れませんでした。/)).toBeInTheDocument();
    await userEvent.click(button);
    await waitFor(() => expect(screen.queryByText(/^プロンプトを作れませんでした。/)).not.toBeInTheDocument());
    expect(screen.getByLabelText("AIの答えを貼り付ける")).toBeInTheDocument();
  });

  it("貼り付けると対応が理由つきで並び、保存すると選んだ分だけ送る（US8-4〜US8-6）", async () => {
    saveExplanations.mockResolvedValue({ saved: [A.id], skipped: [] });
    const user = userEvent.setup();
    renderResearchPage(ResearchPage);
    await screen.findByText("解説がまだの参考投稿：2件");
    await user.click(panel().getByRole("button", { name: /まとめてAIに解説してもらう/ }));
    await user.click(panel().getByLabelText("AIの答えを貼り付ける"));
    await user.paste(
      ["【ID:aaaaaaaa】\n【型の名前】あるある型", "【ID:cccccccc】\n上書き", "【ID:zzzzzzzz】\n不明"].join("\n@@@\n"),
    );
    const rows = panel().getAllByRole("checkbox");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBeChecked();
    expect(rows[1]).toBeDisabled();
    expect(rows[2]).toBeDisabled();
    expect(panel().getByText("すでに解説があります")).toBeInTheDocument();
    expect(panel().getByText("対応する参考投稿が見つかりません")).toBeInTheDocument();
    expect(panel().getByText(/参考投稿：空の投稿A/)).toBeInTheDocument();

    await user.click(panel().getByRole("button", { name: "1件の解説を保存する" }));
    await waitFor(() =>
      expect(saveExplanations).toHaveBeenCalledWith("a1", { items: [{ id: A.id, whyGood: "【型の名前】あるある型" }] }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("1件の解説を保存しました"));
  });

  it("ほかで解説が入っていた分は、飛ばした件数を知らせる（FR-104）", async () => {
    saveExplanations.mockResolvedValue({ saved: [], skipped: [{ id: A.id, reason: "already_explained" }] });
    const user = userEvent.setup();
    renderResearchPage(ResearchPage);
    await screen.findByText("解説がまだの参考投稿：2件");
    await user.click(panel().getByRole("button", { name: /まとめてAIに解説してもらう/ }));
    await user.click(panel().getByLabelText("AIの答えを貼り付ける"));
    await user.paste("【ID:aaaaaaaa】\n解説");
    await user.click(panel().getByRole("button", { name: "1件の解説を保存する" }));
    expect(await screen.findByText("1件は、ほかで解説が入っていたため保存しませんでした")).toBeInTheDocument();
  });

  it("解説がまだの参考投稿がなければ出さない。見せてもらっている人にも出さない（US8-1・US8-8）", async () => {
    listReferencePosts.mockResolvedValue({ items: [C], limit: 200, canEdit: true });
    renderResearchPage(ResearchPage);
    await screen.findByText("解説ありの投稿C");
    expect(screen.queryByRole("region", { name: "まとめてAIに解説してもらう" })).not.toBeInTheDocument();
  });

  it("見せてもらっている人には出さない（US8-8）", async () => {
    listReferencePosts.mockResolvedValue({ items: [A], limit: 200, canEdit: false });
    renderResearchPage(ResearchPage);
    await screen.findByText("空の投稿A");
    expect(screen.queryByRole("region", { name: "まとめてAIに解説してもらう" })).not.toBeInTheDocument();
  });

  it("編集の画面で、1件の解説のプロンプトをコピーし、解説を「なぜ良いか」に入れられる（US8-7、FR-086）", async () => {
    getExplainPrompt.mockResolvedValue({ prompt: "1件の解説のプロンプト", items: [{ id: A.id, shortId: "aaaaaaaa" }], pendingCount: 2 });
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderResearchPage(ResearchPage);
    await screen.findByText("空の投稿A");
    await user.click(screen.getAllByRole("button", { name: "参考投稿の操作" })[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "編集" }));
    const dialog = within(await screen.findByRole("dialog", { name: "参考投稿を編集" }));
    await user.click(dialog.getByRole("button", { name: "解説のプロンプトをコピーする" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("1件の解説のプロンプト"));
    expect(getExplainPrompt).toHaveBeenCalledWith("a1", A.id);
    await user.click(dialog.getByLabelText("解説を貼り付ける"));
    await user.paste("  【型の名前】告白型  ");
    await user.click(dialog.getByRole("button", { name: "なぜ良いかに入れる" }));
    expect(dialog.getByLabelText(/^なぜ良いか/)).toHaveValue("【型の名前】告白型");
  });
});
