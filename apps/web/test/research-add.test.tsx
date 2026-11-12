// US7：参考投稿を、ためてまとめて登録する（specs/014-strategy-guidance FR-080〜FR-085・FR-095〜FR-098）
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { refPost, renderResearchPage } from "./helpers/research";
import { testAccount } from "./helpers/strategy-page";

const listReferencePosts = vi.fn();
const listResearchKeywords = vi.fn();
const createReferencePostsBatch = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api } };
});
vi.mock("@/apps/threads/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/threads/lib/api")>();
  return { ...actual, threadsApi: { ...actual.threadsApi, listReferencePosts, listResearchKeywords, createReferencePostsBatch } };
});
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const { ResearchPage } = await import("@/apps/threads/pages/research");

function posts(n: number, over = {}) {
  return Array.from({ length: n }, (_, i) =>
    refPost({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, body: `既存の投稿${i}`, ...over }),
  );
}

async function openAdd() {
  await userEvent.click(await screen.findByRole("button", { name: "参考投稿を追加" }));
  return within(await screen.findByRole("dialog", { name: "参考投稿を追加" }));
}

beforeEach(() => {
  listReferencePosts.mockReset().mockResolvedValue({ items: posts(1), limit: 200, canEdit: true });
  listResearchKeywords.mockReset().mockResolvedValue({ items: [], limit: 100, canEdit: true });
  createReferencePostsBatch.mockReset();
  toastSuccess.mockReset();
});

describe("参考投稿を追加（ためて登録）", () => {
  it("ためると、その投稿が上に並び、欄が空になる。キーワードと媒体は残り、投稿日は不明に戻る（FR-081・FR-082）", async () => {
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    await userEvent.type(d.getByLabelText(/^本文/), "社会人になってから友達が増えない");
    await userEvent.type(d.getByLabelText("検索したキーワード"), "20代後半 友達");
    await userEvent.selectOptions(d.getByLabelText("媒体"), "instagram");
    await userEvent.selectOptions(d.getByLabelText("元の投稿の投稿日"), "week");
    await userEvent.click(d.getByRole("button", { name: /投稿の数字・投稿者/ }));
    await userEvent.type(d.getByLabelText("閲覧数"), "32000");
    await userEvent.click(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }));

    const queued = within(d.getByRole("region", { name: /ためた投稿/ }));
    expect(queued.getByText(/社会人になってから友達が増えない/)).toBeInTheDocument();
    expect(queued.getByText("Instagram")).toBeInTheDocument();
    expect(queued.getByText("最新")).toBeInTheDocument();
    expect(d.getByLabelText(/^本文/)).toHaveValue("");
    expect(d.getByLabelText("検索したキーワード")).toHaveValue("20代後半 友達");
    expect(d.getByLabelText("媒体")).toHaveValue("instagram");
    expect(d.getByLabelText("元の投稿の投稿日")).toHaveValue("unknown");
    expect(d.getAllByRole("button", { name: "1件を登録する" }).length).toBeGreaterThan(0);
  });

  it("本文が空なら「ためる」は押せず、検証に通らなければためない（FR-081）", async () => {
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    const enqueue = d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" });
    expect(enqueue).toBeDisabled();
    await userEvent.type(d.getByLabelText(/^本文/), "本文");
    await userEvent.selectOptions(d.getByLabelText("元の投稿の投稿日"), "exact");
    await userEvent.click(enqueue);
    expect(d.getByText("投稿日を入れてください")).toBeInTheDocument();
    expect(d.queryByRole("region", { name: /ためた投稿/ })).not.toBeInTheDocument();
  });

  it("「外す」でためた投稿を取り除ける", async () => {
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    await userEvent.type(d.getByLabelText(/^本文/), "外す投稿");
    await userEvent.click(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }));
    await userEvent.click(within(d.getByRole("region", { name: /ためた投稿/ })).getByRole("button", { name: "外す" }));
    expect(d.queryByRole("region", { name: /ためた投稿/ })).not.toBeInTheDocument();
    expect(d.getAllByRole("button", { name: "登録する" }).length).toBeGreaterThan(0);
  });

  it("ためた分と入力中の分を、ためた順にまとめて登録する（FR-083）", async () => {
    createReferencePostsBatch.mockResolvedValue({ items: [] });
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    for (const body of ["1件目", "2件目"]) {
      await userEvent.type(d.getByLabelText(/^本文/), body);
      await userEvent.click(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }));
    }
    await userEvent.type(d.getByLabelText(/^本文/), "3件目");
    await userEvent.click(d.getAllByRole("button", { name: "3件を登録する" })[0]!);
    await waitFor(() => expect(createReferencePostsBatch).toHaveBeenCalledTimes(1));
    const [, body] = createReferencePostsBatch.mock.calls[0]!;
    expect(body.items.map((i: { body: string }) => i.body)).toEqual(["1件目", "2件目", "3件目"]);
    expect(body.items[0]).toMatchObject({ platform: "threads", postedDateMode: "unknown", postedDate: null });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("3件を登録しました"));
    expect(screen.queryByRole("dialog", { name: "参考投稿を追加" })).not.toBeInTheDocument();
  });

  it("残りの件数に達したら「ためる」を押せず、あと何件かを出す（US7-5、FR-084）", async () => {
    listReferencePosts.mockResolvedValue({ items: posts(199), limit: 200, canEdit: true });
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    expect(d.getByText("参考投稿はあと1件まで登録できます")).toBeInTheDocument();
    await userEvent.type(d.getByLabelText(/^本文/), "1件目");
    await userEvent.click(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }));
    await userEvent.type(d.getByLabelText(/^本文/), "2件目");
    expect(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" })).toBeDisabled();
    expect(d.getAllByRole("button", { name: "2件を登録する" })[0]).toBeDisabled();
  });

  it("ためた投稿があるときに閉じると、破棄してよいかを確かめる（US7-6）", async () => {
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    await userEvent.type(d.getByLabelText(/^本文/), "下書き");
    await userEvent.click(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }));
    await userEvent.click(d.getByRole("button", { name: "閉じる" }));
    expect(await screen.findByText("登録していない投稿があります。破棄しますか？")).toBeInTheDocument();
  });

  it("本文が空でも、ほかの項目を入れていれば、閉じるときに破棄してよいかを確かめる（PR #17 のCodexレビュー）", async () => {
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    await userEvent.type(d.getByLabelText("投稿のURL"), "https://www.threads.com/@a/post/1");
    await userEvent.click(d.getByRole("button", { name: "閉じる" }));
    expect(await screen.findByText("登録していない投稿があります。破棄しますか？")).toBeInTheDocument();
  });

  it("ためた後に本文なしでほかの項目だけ入れていると、登録せずに本文を求める（入力を黙って捨てない。PR #17 のCodexレビュー）", async () => {
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    await userEvent.type(d.getByLabelText(/^本文/), "1件目");
    await userEvent.type(d.getByLabelText("検索したキーワード"), "転職");
    await userEvent.click(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }));
    // 引き継いだキーワード・媒体だけなら、ためた分を登録できる
    expect(d.getAllByRole("button", { name: "1件を登録する" })[0]).toBeEnabled();
    await userEvent.type(d.getByLabelText("投稿のURL"), "https://www.threads.com/@a/post/2");
    await userEvent.click(d.getAllByRole("button", { name: "1件を登録する" })[0]!);
    expect(await d.findByText("入力してください")).toBeInTheDocument();
    expect(createReferencePostsBatch).not.toHaveBeenCalled();
  });

  it("ためた後に引き継いだキーワードを変えていれば、登録せずに本文を求める（PR #17 のCodexレビュー6回目）", async () => {
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    await userEvent.type(d.getByLabelText(/^本文/), "1件目");
    await userEvent.type(d.getByLabelText("検索したキーワード"), "転職");
    await userEvent.click(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }));
    await userEvent.type(d.getByLabelText("検索したキーワード"), " 20代");
    await userEvent.click(d.getAllByRole("button", { name: "1件を登録する" })[0]!);
    expect(await d.findByText("入力してください")).toBeInTheDocument();
    expect(createReferencePostsBatch).not.toHaveBeenCalled();
  });

  it("登録の途中は、ためた投稿を外せない（PR #17 のCodexレビュー）", async () => {
    createReferencePostsBatch.mockImplementation(() => new Promise(() => {}));
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    await userEvent.type(d.getByLabelText(/^本文/), "1件目");
    await userEvent.click(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }));
    await userEvent.click(d.getAllByRole("button", { name: "1件を登録する" })[0]!);
    await waitFor(() => expect(d.getByRole("button", { name: "外す" })).toBeDisabled());
  });

  it("登録の途中は閉じられない（破棄したつもりで登録されるのを防ぐ。PR #17 のCodexレビュー）", async () => {
    createReferencePostsBatch.mockImplementation(() => new Promise(() => {}));
    renderResearchPage(ResearchPage);
    const d = await openAdd();
    await userEvent.type(d.getByLabelText(/^本文/), "1件目");
    await userEvent.click(d.getAllByRole("button", { name: "登録する" })[0]!);
    await waitFor(() => expect(createReferencePostsBatch).toHaveBeenCalled());
    await userEvent.click(d.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByText("登録していない投稿があります。破棄しますか？")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "参考投稿を追加" })).toBeInTheDocument();
  });

  it("アカウントを切り替えると、追加の欄とためた投稿を捨てる（ほかのアカウントに登録しない。PR #17 のCodexレビュー）", async () => {
    function Layout() {
      const [current, setCurrent] = useState(testAccount);
      return (
        <>
          <button type="button" onClick={() => setCurrent({ ...testAccount, id: "a2", name: "別のアカウント" })}>
            切り替え
          </button>
          <Outlet context={{ account: current }} />
        </>
      );
    }
    const router = createMemoryRouter(
      [{ path: "/threads/accounts/:accountId", element: <Layout />, children: [{ path: "research", element: <ResearchPage /> }] }],
      { initialEntries: ["/threads/accounts/a1/research"] },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const d = await openAdd();
    await userEvent.type(d.getByLabelText(/^本文/), "Aの投稿");
    await userEvent.click(d.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }));
    // ダイアログの外のボタン（アカウントの切り替え）を押した扱いにする
    fireEvent.click(screen.getByRole("button", { name: "切り替え", hidden: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "参考投稿を追加" })).not.toBeInTheDocument());
    expect(createReferencePostsBatch).not.toHaveBeenCalled();
  });

  it("一覧のカードに、媒体・鮮度・解説の有無・閲覧といいねが出る（US7-8）", async () => {
    listReferencePosts.mockResolvedValue({
      items: [
        refPost({
          platform: "instagram",
          freshness: "latest",
          whyGood: "解説",
          metrics: { likes: 820, replies: null, views: 32000, saves: null, reposts: null, followers: null },
        }),
      ],
      limit: 200,
      canEdit: true,
    });
    renderResearchPage(ResearchPage);
    const card = within((await screen.findByText("伸びていた投稿の本文")).closest("article")!);
    expect(card.getByText("Instagram")).toBeInTheDocument();
    expect(card.getByText("最新")).toBeInTheDocument();
    expect(card.getByText("解説あり")).toBeInTheDocument();
    expect(card.getByText("閲覧 32,000 ・ いいね 820")).toBeInTheDocument();
  });
});
