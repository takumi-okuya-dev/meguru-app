// US14：長いプロンプトを2つに分けて送る（specs/014-strategy-guidance FR-150〜FR-153、research.md R12・R15）
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ACCESS } from "./helpers/access";
import { listResponse, promptResponse, renderAccountRoutes } from "./helpers/stock";

const listPostDrafts = vi.fn();
const getPrompt = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, accountAccess: async () => OWNER_ACCESS, listPostDrafts, getPrompt } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { CreatePage } = await import("@/pages/create");

const MODE_KEY = "threads-grower:prompt-send-mode";
const LONG = { ...promptResponse(), prompt: "全文", parts: ["1つ目の全文", "2つ目の全文"] as [string, string], length: 15000, splitRecommended: true };
const SHORT = { ...promptResponse(), prompt: "全文", parts: ["1つ目の全文", "2つ目の全文"] as [string, string], length: 8000, splitRecommended: false };

function renderCreate() {
  return renderAccountRoutes([{ path: "create", element: <CreatePage /> }], "/accounts/a1/create");
}

beforeEach(() => {
  localStorage.clear();
  listPostDrafts.mockReset().mockResolvedValue(listResponse());
  getPrompt.mockReset().mockResolvedValue(SHORT);
});

describe("プロンプトの長さと送り方", () => {
  it("短いときは文字数を出し、「1つにまとめて送る」が初めの選択で、注意は出ない", async () => {
    renderCreate();
    expect(await screen.findByText("プロンプトの長さ：約8,000字")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "1つにまとめて送る" })).toBeChecked();
    expect(screen.queryByText(/プロンプトが長いです/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "コピー" })).toBeInTheDocument();
  });

  it("12,000字を超えると注意を出し、「2つに分けて送る（おすすめ）」が初めの選択（FR-150・FR-151）", async () => {
    getPrompt.mockResolvedValue(LONG);
    renderCreate();
    expect(
      await screen.findByText("プロンプトが長いです。無料のAIでは途中で切られることがあります。2つに分けて送るのがおすすめです"),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "2つに分けて送る（おすすめ）" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "コピー" })).not.toBeInTheDocument();
  });

  it("2つに分けると、それぞれをコピー・中身を見るができる。書き換えは1つにまとめたときだけ（FR-152・FR-153）", async () => {
    const user = userEvent.setup();
    getPrompt.mockResolvedValue(LONG);
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderCreate();
    const first = within(await screen.findByRole("group", { name: "① 1つ目" }));
    expect(first.getByText("送ったら、AIの「受け取りました」を待つ")).toBeInTheDocument();
    await user.click(first.getByRole("button", { name: "1つ目をコピー" }));
    expect(writeText.mock.calls.at(-1)?.[0]).toBe("1つ目の全文");
    const second = within(screen.getByRole("group", { name: "② 2つ目（最後）" }));
    expect(second.getByText("これを送ると、投稿が作られます")).toBeInTheDocument();
    await user.click(second.getByRole("button", { name: "2つ目をコピー" }));
    expect(writeText.mock.calls.at(-1)?.[0]).toBe("2つ目の全文");
    await user.click(second.getByRole("button", { name: "中身を見る" }));
    const area = second.getByRole("textbox", { name: "2つ目の全文" });
    expect(area).toHaveValue("2つ目の全文");
    expect(area).toHaveAttribute("readonly");
  });

  it("切り替えを端末に覚え、次に開いたときもその送り方にする", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(await screen.findByRole("radio", { name: "2つに分けて送る" }));
    expect(localStorage.getItem(MODE_KEY)).toBe("split");
    expect(screen.getByRole("group", { name: "① 1つ目" })).toBeInTheDocument();
    getPrompt.mockResolvedValue(SHORT);
    document.body.innerHTML = "";
    renderCreate();
    await waitFor(() => expect(screen.getByRole("radio", { name: "2つに分けて送る" })).toBeChecked());
  });

  it("2つに分けているときは、開いたときに「1つ目をコピー」にフォーカスする", async () => {
    getPrompt.mockResolvedValue(LONG);
    renderCreate();
    const copy = await screen.findByRole("button", { name: "1つ目をコピー" });
    await waitFor(() => expect(copy).toHaveFocus());
  });
});
