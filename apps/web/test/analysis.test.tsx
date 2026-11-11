// 解析の画面（specs/022-algorithm-analysis contracts/ui-routes.md、tasks.md T014・T022・T029・T036）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  POST_LENGTH_DEFAULTS,
  analyzePosts,
  type AccountSummary,
  type AnalysisPost,
  type AnalysisResponse,
  type ClassificationsResponse,
} from "@meguru/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analysis: vi.fn(),
  patchAnalysisSettings: vi.fn(),
  classifications: vi.fn(),
  putClassifications: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AnalysisPage } = await import("@/pages/analysis");

const account = {
  id: "a1",
  name: "店",
  username: "shop",
  displayName: "店",
  profilePictureUrl: null,
  connectionStatus: "connected",
  lastUsedAt: null,
  role: "owner",
  ownerName: null,
} as AccountSummary;

const HOURS = [7, 12, 17, 21];

/**
 * 夜の閲覧が高い投稿の並び。
 * @param n - 件数
 * @param over - 投稿ごとに変えるところ
 * @returns 投稿
 */
function posts(n: number, over: (i: number) => Partial<AnalysisPost> = () => ({})): AnalysisPost[] {
  return Array.from({ length: n }, (_, i) => {
    const hour = HOURS[i % 4]!;
    const ymd = new Date(Date.UTC(2026, 7, 3 + i)).toISOString().slice(0, 10);
    return {
      id: `p${i}`,
      body: `投稿${i}の本文です`,
      publishedAt: new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00+09:00`).toISOString(),
      views: hour === 21 ? 400 : 200,
      likes: 5,
      replies: 1,
      reposts: 0,
      quotes: 0,
      followersAtPost: 100,
      h24Views: 100,
      openingType: null,
      themeId: null,
      promo: false,
      ...over(i),
    };
  });
}

/**
 * 解析の応答を、shared の計算から作る。
 * @param list - 投稿
 * @param over - 変えるところ
 * @returns 応答
 */
function response(list: AnalysisPost[], over: Partial<AnalysisResponse> = {}): AnalysisResponse {
  const themes = over.settings?.themes ?? [];
  return {
    period: { from: "2026-08-08", to: "2026-11-05", days: 90 },
    scope: "all",
    ...analyzePosts(list, { lengthSettings: POST_LENGTH_DEFAULTS, themes }),
    schedule: { slotTimes: ["07:30", "21:00"] },
    settings: { trendsInPrompt: true, themes: [], version: null },
    canEdit: true,
    ...over,
  };
}

function renderAt(path = "/accounts/a1/analysis") {
  const router = createMemoryRouter(
    [
      {
        path: "/accounts/:accountId",
        element: <Outlet context={{ account }} />,
        children: [
          { path: "analysis", element: <AnalysisPage /> },
          { path: "settings", element: <p>アカウントの設定の画面</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.analysis.mockResolvedValue(response(posts(60)));
  mocks.patchAnalysisSettings.mockResolvedValue({ settings: { trendsInPrompt: false, themes: [], version: 1 } });
});

describe("解析の画面（US1）", () => {
  it("見出し・件数・閉じた説明・傾向・時間帯の表", async () => {
    const user = userEvent.setup();
    renderAt();
    expect(await screen.findByRole("heading", { name: "解析" })).toBeInTheDocument();
    expect((await screen.findAllByText("直近90日・確定した投稿 60件")).length).toBeGreaterThan(0);
    const help = screen.getByRole("button", { name: "この画面の見方" });
    expect(help).toHaveAttribute("aria-expanded", "false");
    await user.click(help);
    const points = within(screen.getByRole("list", { name: "この画面の見方" })).getAllByRole("listitem");
    expect(points).toHaveLength(5);
    expect(points[2]).toHaveTextContent("表示の順位はThreadsから取れないので");
    const trends = within(screen.getByRole("list", { name: "伸びた傾向" }));
    expect(trends.getByText(/夜（20〜23時）に出した投稿が伸びやすい/)).toBeInTheDocument();
    expect(trends.getByText("時刻の参考")).toBeInTheDocument();
    expect(trends.getByText("15件・閲覧の中央値 400（ほかの投稿 200）")).toBeInTheDocument();
    const time = within(screen.getByRole("list", { name: "時間帯" }));
    expect(time.getByText("深夜（0〜4時）").parentElement).toHaveTextContent("試していない");
    expect(screen.getByRole("list", { name: "曜日" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "文字数" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "本文の特徴" })).toBeInTheDocument();
  });

  it("件数が足りないと、あと何件かだけを出す", async () => {
    mocks.analysis.mockResolvedValue(response(posts(12)));
    renderAt();
    expect(await screen.findByText("あと8件たまると見られます")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "時間帯" })).not.toBeInTheDocument();
  });

  it("傾向がなければ「まだはっきりした傾向はありません」", async () => {
    mocks.analysis.mockResolvedValue(response(posts(30, () => ({ views: 300 }))));
    renderAt();
    expect(await screen.findByText("まだはっきりした傾向はありません")).toBeInTheDocument();
  });

  it("「ふだんの投稿」で scope=regular を読む", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("radio", { name: "ふだんの投稿" }));
    await waitFor(() => expect(mocks.analysis).toHaveBeenLastCalledWith("a1", "regular"));
  });
});

describe("おすすめに乗った目安（US2）", () => {
  it("初めは3件、残りを見るで全部。ほかの投稿とのちがい", async () => {
    const user = userEvent.setup();
    mocks.analysis.mockResolvedValue(response(posts(30, (i) => ({ views: 50 + i * 10, body: `${i}番目の投稿` }))));
    renderAt();
    const list = await screen.findByRole("list", { name: "おすすめに乗った目安の投稿" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("広がり ×3.4");
    await user.click(screen.getByRole("button", { name: "残りの3件を見る" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("ほかの投稿とのちがい（中央値）")).toBeInTheDocument();
    expect(screen.getByText("おすすめに乗った目安（6件）")).toBeInTheDocument();
  });

  it("フォロワー数の記録が足りないとき・記録の前の投稿があるとき", async () => {
    mocks.analysis.mockResolvedValueOnce(response(posts(30, () => ({ followersAtPost: null }))));
    renderAt();
    expect(await screen.findByText("フォロワー数の記録がある投稿が10件たまると見られます")).toBeInTheDocument();
  });

  it("記録の前の投稿を外した件数を出す", async () => {
    mocks.analysis.mockResolvedValue(response(posts(30, (i) => ({ views: 50 + i * 10, followersAtPost: i < 5 ? null : 100 }))));
    renderAt();
    expect(await screen.findByText("フォロワー数を記録する前の5件は、広がりを出せないので外しています。")).toBeInTheDocument();
  });
});

describe("投稿づくりに活かす（US3）", () => {
  it("「プロンプトに入れる」の切り替えで保存する", async () => {
    const user = userEvent.setup();
    renderAt();
    const sw = await screen.findByRole("switch", { name: "プロンプトに入れる" });
    expect(sw).toBeChecked();
    await user.click(sw);
    await waitFor(() => expect(mocks.patchAnalysisSettings).toHaveBeenCalledWith("a1", { expectedVersion: null, trendsInPrompt: false }));
  });

  it("編集できない人には切り替えと分類のボタンを出さない", async () => {
    mocks.analysis.mockResolvedValue(response(posts(60), { canEdit: false }));
    renderAt();
    await screen.findByRole("list", { name: "伸びた傾向" });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "内容を分類する" })).not.toBeInTheDocument();
  });

  it("時刻の見直しの参考：今の時刻と時間帯の傾向、投稿の時刻を開く", async () => {
    const user = userEvent.setup();
    const router = renderAt();
    expect(await screen.findByText("今の時刻：7:30・21:00")).toBeInTheDocument();
    expect(screen.getByText("伸びやすい：夜（20〜23時）")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "投稿の時刻を開く" }));
    expect(router.state.location.pathname).toBe("/accounts/a1/settings");
  });
});

describe("内容を分類する（US4）", () => {
  const unclassified: ClassificationsResponse = {
    posts: [
      { draftId: "d1", body: "会社員3年目で気づいたこと", publishedAt: "2026-10-01T12:00:00.000Z", openingType: null, themeId: null },
      { draftId: "d2", body: "転職して変わったのは給料じゃなかった", publishedAt: "2026-10-02T12:00:00.000Z", openingType: null, themeId: null },
    ],
    remaining: 0,
    themes: [{ id: "t1", name: "転職" }],
  };

  it("内容の表と、書き出しの型・テーマの切り替え", async () => {
    const user = userEvent.setup();
    mocks.analysis.mockResolvedValue(
      response(posts(60, (i) => (i < 30 ? { openingType: i % 2 ? "aruaru" : "story", themeId: "t1" } : {})), {
        settings: { trendsInPrompt: true, themes: [{ id: "t1", name: "転職" }], version: 2 },
      }),
    );
    renderAt();
    expect(await screen.findByText("分類が付いた投稿 30件 / 60件")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "書き出しの型" })).getByText("あるある")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "テーマ" }));
    expect(within(screen.getByRole("list", { name: "テーマ" })).getByText("転職")).toBeInTheDocument();
  });

  it("プロンプトをコピー → 答えを貼る → 候補 → 反映する", async () => {
    const user = userEvent.setup();
    mocks.classifications.mockResolvedValue(unclassified);
    mocks.putClassifications.mockResolvedValue({ saved: 1, skipped: [] });
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderAt();
    await user.click(await screen.findByRole("button", { name: "内容を分類する" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("分類が付いていない確定した投稿 2件（1回に50件まで）")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "プロンプトをコピーする" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain("【2】\n転職して変わったのは給料じゃなかった");
    await user.type(
      within(dialog).getByLabelText("AIの答えを貼り付ける"),
      "【1】書き出しの型：体験談／テーマ：転職\n【2】書き出しの型：ジョーク",
    );
    await user.click(within(dialog).getByRole("button", { name: "読み取る" }));
    expect(within(dialog).getByText(/1件を読み取りました。1件は読み取れなかったので保存しません。/)).toBeInTheDocument();
    expect(within(dialog).getByText(/知らない書き出しの型「ジョーク」のため保存しません/)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "書き出しの型（1）" }), "あるある");
    // 全画面のシートとダイアログで、同じボタンが2つある
    await user.click(within(dialog).getAllByRole("button", { name: "1件を反映する" })[0]!);
    await waitFor(() =>
      expect(mocks.putClassifications).toHaveBeenCalledWith("a1", {
        source: "ai",
        items: [{ draftId: "d1", openingType: "aruaru", themeId: "t1" }],
      }),
    );
  });

  it("テーマを直して保存する", async () => {
    const user = userEvent.setup();
    mocks.classifications.mockResolvedValue(unclassified);
    mocks.patchAnalysisSettings.mockResolvedValue({ settings: { trendsInPrompt: true, themes: [], version: 1 } });
    renderAt();
    await user.click(await screen.findByRole("button", { name: "内容を分類する" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "テーマを直す" }));
    await user.click(within(dialog).getByRole("button", { name: "テーマを足す" }));
    await user.type(within(dialog).getByRole("textbox", { name: "テーマ2の名前" }), "働き方");
    await user.click(within(dialog).getByRole("button", { name: "テーマを保存" }));
    await waitFor(() =>
      expect(mocks.patchAnalysisSettings).toHaveBeenCalledWith("a1", {
        expectedVersion: null,
        themes: [{ id: "t1", name: "転職" }, { name: "働き方" }],
      }),
    );
  });

  it("分類済みで選び直すと、その場で保存する。投稿がなければその表示", async () => {
    const user = userEvent.setup();
    mocks.classifications.mockImplementation((_a: string, mode: string) =>
      Promise.resolve(
        mode === "classified"
          ? { posts: [{ ...unclassified.posts[0]!, openingType: "story", themeId: null }], remaining: 0, themes: unclassified.themes }
          : { posts: [], remaining: 0, themes: [] },
      ),
    );
    mocks.putClassifications.mockResolvedValue({ saved: 1, skipped: [] });
    renderAt();
    await user.click(await screen.findByRole("button", { name: "内容を分類する" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("分類する投稿はありません")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("tab", { name: "分類済み" }));
    await user.selectOptions(await within(dialog).findByRole("combobox", { name: "テーマ（1）" }), "転職");
    await waitFor(() =>
      expect(mocks.putClassifications).toHaveBeenCalledWith("a1", {
        source: "manual",
        items: [{ draftId: "d1", openingType: "story", themeId: "t1" }],
      }),
    );
  });
});
