// 外部媒体展開の画面（specs/021-external-media contracts/ui-routes.md 2〜4、tasks.md T027・T045・T050・T053）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  buildListing,
  type AccountSummary,
  type ListingDetail,
  type Promotion,
} from "@meguru/shared";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  externalMedia: vi.fn(),
  listing: vi.fn(),
  generateListing: vi.fn(),
  updateListing: vi.fn(),
  mediaDefaults: vi.fn(),
  putMediaDefaults: vi.fn(),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, ...mocks } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApiError } = await import("@/lib/api-client");
const { UnsavedChangesProvider } = await import("@/components/UnsavedChangesProvider");
const { ExternalMediaPage } = await import("@/apps/threads/pages/external-media");
const { ExternalMediaListingPage } = await import("@/apps/threads/pages/external-media-listing");

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

const EVENT = {
  startAt: "2026-11-25T20:00",
  endAt: "2026-11-25T22:00",
  format: "venue" as const,
  venueName: "バー SHITEN",
  prefecture: "東京都" as const,
  address: "台東区上野4-1-8",
  building: null,
  station: "御徒町駅 徒歩3分",
  capacity: 25,
  feeYen: 5000,
  feeNote: null,
  cancelPolicy: "当日：100%",
  audience: null,
  organizer: null,
};

const promotion: Promotion = {
  id: "p1",
  title: "IT交流会 ゆるく繋がる飲み会",
  content: "ゆるく繋がる飲み会です\n人脈づくりにぜひ",
  targetLocation: "",
  targetPersona: "",
  targetAgeRange: "",
  cta: "",
  linkedUrl: "https://example.com/e/1",
  priority: 0,
  status: "active",
  validUntil: null,
  event: EVENT,
  isExpired: false,
  isTargetable: true,
  version: 1,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const source = { ...promotion, event: EVENT, defaults: {} };

function detail(
  over: Partial<ListingDetail["listing"]> = {},
  media: ListingDetail["media"] = "peatix",
): ListingDetail {
  const b = buildListing(media, source);
  return {
    promotion,
    media,
    listing: {
      status: "drafting",
      postedUrl: null,
      imageStyle: "illustration",
      fields: b.fields,
      fixes: b.fixes,
      generatedAt: "2026-11-04T00:00:00.000Z",
      sourceVersion: 1,
      version: 1,
      ...over,
    },
    defaults: {},
    sourceChanged: false,
    canEdit: true,
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/threads/accounts/:accountId",
        element: (
          <UnsavedChangesProvider>
            <Outlet context={{ account }} />
          </UnsavedChangesProvider>
        ),
        children: [
          { path: "external-media", element: <ExternalMediaPage /> },
          { path: "external-media/:promotionId/:media", element: <ExternalMediaListingPage /> },
          { path: "promotions", element: <p>宣伝内容の画面</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.externalMedia.mockResolvedValue({
    promotions: [
      {
        id: "p1",
        title: promotion.title,
        version: 1,
        event: EVENT,
        listings: [
          { media: "youtrust", status: "posted", postedUrl: "https://youtrust.jp/e/1" },
          { media: "peatix", status: "drafting", postedUrl: null },
        ],
      },
      { id: "p2", title: "イベントなし", version: 1, event: null, listings: [] },
    ],
    canEdit: true,
  });
  mocks.listing.mockResolvedValue(detail());
});

describe("一覧（contracts/ui-routes.md 2）", () => {
  it("イベントの選ぶ欄（開催日時のあるものだけ・［掲載済み：〇〇］つき）と、5つの媒体の行と状況", async () => {
    renderAt("/threads/accounts/a1/external-media");
    const select = await screen.findByRole("combobox", { name: "イベント" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["11/25(水) IT交流会 ゆるく繋がる飲み会　［掲載済み：YOUTRUST］"]);
    const rows = within(screen.getByRole("list", { name: "媒体" })).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(within(rows[0]!).getByText("未着手")).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("link", { name: "掲載内容を作る" })).toHaveAttribute(
      "href",
      "/threads/accounts/a1/external-media/p1/kokuchpro",
    );
    expect(within(rows[1]!).getByText("作成中")).toBeInTheDocument();
    expect(within(rows[1]!).getByRole("link", { name: "開く" })).toBeInTheDocument();
    expect(within(rows[4]!).getByText("掲載済み")).toBeInTheDocument();
  });

  it("開催日時のある宣伝内容がなければ、宣伝内容へ案内する", async () => {
    mocks.externalMedia.mockResolvedValue({
      promotions: [{ id: "p2", title: "x", version: 1, event: null, listings: [] }],
      canEdit: true,
    });
    renderAt("/threads/accounts/a1/external-media");
    expect(
      await screen.findByText("宣伝内容に、イベントの情報を入れると使えます。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "宣伝内容を開く" })).toHaveAttribute(
      "href",
      "/threads/accounts/a1/promotions",
    );
  });

  it("見せてもらっている人（ROLE_FORBIDDEN）には、オーナーと担当の人だけが使えると出す", async () => {
    mocks.externalMedia.mockRejectedValue(new ApiError("ROLE_FORBIDDEN", 403));
    renderAt("/threads/accounts/a1/external-media");
    expect(
      await screen.findByText("この画面は、オーナーと担当の人だけが使えます。"),
    ).toBeInTheDocument();
  });

  it("閉じたトグル「媒体の既定値」を開くと、媒体ごとの欄が出て保存できる", async () => {
    mocks.mediaDefaults.mockResolvedValue({
      items: ["kokuchpro", "peatix", "tsunagate", "jmty", "youtrust"].map((m) => ({
        media: m,
        values: {},
        version: null,
      })),
      canEdit: true,
    });
    mocks.putMediaDefaults.mockResolvedValue({
      media: "peatix",
      values: { emergencyTel: "03" },
      version: 1,
    });
    const user = userEvent.setup();
    renderAt("/threads/accounts/a1/external-media");
    await user.click(await screen.findByRole("button", { name: /媒体の既定値/ }));
    const peatix = await screen.findByRole("region", { name: "Peatixの既定値" });
    await user.type(within(peatix).getByLabelText("緊急連絡用電話番号"), "03");
    await user.click(within(peatix).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.putMediaDefaults).toHaveBeenCalledWith(
        "a1",
        "peatix",
        null,
        expect.objectContaining({ emergencyTel: "03" }),
      ),
    );
  });
});

describe("入力の画面（contracts/ui-routes.md 3）", () => {
  it("区切りの見出しと欄のカード（必須・文字数・コピー・説明・選ぶ欄の理由・ほかの案）と、宣伝内容の元の情報", async () => {
    renderAt("/threads/accounts/a1/external-media/p1/peatix");
    expect(await screen.findByRole("region", { name: "ステップ1｜基本情報" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^イベント名/ })).toHaveValue(
      "【11/25(水)20時〜】IT交流会 ゆるく繋がる飲み会｜御徒町",
    );
    expect(screen.getByText(/\/ 45文字/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "イベント名をコピー" })).toBeInTheDocument();
    expect(screen.getByText(/このイベントでは「会場開催」を選びます/)).toBeInTheDocument();
    expect(screen.getByText("ほかの案（押すと入れ替えます）")).toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: "宣伝内容の元の情報" })).getByText(
        "2026年11月25日(水) 20:00 〜 22:00",
      ),
    ).toBeInTheDocument();
  });

  it("ルールのチェックの枠（件数と項目）。直すと出し直す。閉じたトグル「自動で直した内容」", async () => {
    mocks.listing.mockResolvedValue(detail({}, "tsunagate"));
    const user = userEvent.setup();
    renderAt("/threads/accounts/a1/external-media/p1/tsunagate");
    const box = await screen.findByRole("region", { name: "ルールのチェック" });
    expect(within(box).getByText(/人脈/)).toBeInTheDocument();
    const intro = screen.getByRole("textbox", { name: /^紹介文/ });
    await user.clear(intro);
    await user.type(intro, "楽しい会です");
    await waitFor(() => expect(within(box).queryByText(/人脈/)).not.toBeInTheDocument());
    await user.type(intro, "{enter}LINEで連絡");
    await user.click(within(box).getByRole("button", { name: /自動で直した内容/ }));
    expect(within(box).getByRole("list", { name: "自動で直した内容" })).toHaveTextContent("LINE");
  });

  it("欄を直して保存すると、欄・状況・掲載URL・画像の種類を送る", async () => {
    mocks.updateListing.mockResolvedValue(detail({ version: 2 }));
    const user = userEvent.setup();
    renderAt("/threads/accounts/a1/external-media/p1/peatix");
    const title = await screen.findByRole("textbox", { name: /^イベント名/ });
    await user.clear(title);
    await user.type(title, "新しいタイトル");
    await user.selectOptions(screen.getByLabelText("状況"), "掲載済み");
    await user.type(screen.getByLabelText(/掲載URL/), "https://peatix.com/e/1");
    await user.click(screen.getByRole("radio", { name: "写真を使う" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.updateListing).toHaveBeenCalledWith(
        "a1",
        "p1",
        "peatix",
        expect.objectContaining({
          expectedVersion: 1,
          status: "posted",
          postedUrl: "https://peatix.com/e/1",
          imageStyle: "photo",
          fields: expect.objectContaining({ title: "新しいタイトル" }),
        }),
      ),
    );
  });

  it("保存がぶつかったら知らせ、上書きは最新の版で送る（FR-064）", async () => {
    mocks.updateListing
      .mockRejectedValueOnce(
        new ApiError("STALE_UPDATE", 409, [], { version: 5 }, { name: "田中" }),
      )
      .mockResolvedValueOnce(detail({ version: 6 }));
    const user = userEvent.setup();
    renderAt("/threads/accounts/a1/external-media/p1/peatix");
    await user.type(await screen.findByRole("textbox", { name: /^イベント名/ }), "x");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("田中さんが先に保存しました")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "自分の内容で上書きする" }));
    await waitFor(() =>
      expect(mocks.updateListing).toHaveBeenLastCalledWith(
        "a1",
        "p1",
        "peatix",
        expect.objectContaining({ expectedVersion: 5 }),
      ),
    );
  });

  it("まだ作っていなければ「掲載内容を作る」だけ。押すと作る", async () => {
    mocks.listing.mockResolvedValue(
      detail({
        fields: null,
        fixes: [],
        status: "not_started",
        version: null,
        sourceVersion: null,
        generatedAt: null,
      }),
    );
    mocks.generateListing.mockResolvedValue(detail());
    const user = userEvent.setup();
    renderAt("/threads/accounts/a1/external-media/p1/peatix");
    await user.click(await screen.findByRole("button", { name: "掲載内容を作る" }));
    await waitFor(() =>
      expect(mocks.generateListing).toHaveBeenCalledWith("a1", "p1", "peatix", null),
    );
  });

  it("宣伝内容が変わったら帯を出し、作り直しは確かめてから", async () => {
    mocks.listing.mockResolvedValue({ ...detail(), sourceChanged: true });
    mocks.generateListing.mockResolvedValue(detail());
    const user = userEvent.setup();
    renderAt("/threads/accounts/a1/external-media/p1/peatix");
    expect(await screen.findByText(/宣伝内容が変わりました/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "作り直す" })[0]!);
    expect(screen.getByText("掲載内容を作り直しますか？")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "作り直す" }));
    await waitFor(() =>
      expect(mocks.generateListing).toHaveBeenCalledWith("a1", "p1", "peatix", 1),
    );
  });

  it("まとめてコピー・画像のプロンプトのコピー", async () => {
    const user = userEvent.setup();
    renderAt("/threads/accounts/a1/external-media/p1/peatix");
    await user.click(await screen.findByRole("button", { name: "まとめてコピー" }));
    expect(await navigator.clipboard.readText()).toContain("【Peatixの掲載内容】");
    await user.click(screen.getByRole("button", { name: "画像のプロンプトをコピー" }));
    expect(await navigator.clipboard.readText()).toContain("1840×900");
  });

  it("AIと整える：プロンプトをコピー → 答えを貼る → 反映するとタイトルと本文が入る", async () => {
    const user = userEvent.setup();
    renderAt("/threads/accounts/a1/external-media/p1/peatix");
    await user.click(await screen.findByRole("button", { name: "AIと整える" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "プロンプトをコピーする" }));
    expect(await navigator.clipboard.readText()).toContain("【タイトル】");
    await user.click(within(dialog).getByLabelText("AIの答えを貼り付ける"));
    await user.paste("【タイトル】\nAIのタイトル\n【本文】\nAIの本文\n【ここまで】");
    await user.click(within(dialog).getAllByRole("button", { name: "反映する" })[0]!);
    expect(screen.getByRole("textbox", { name: /^イベント名/ })).toHaveValue("AIのタイトル");
    expect(screen.getByRole("textbox", { name: /^イベントの詳細/ })).toHaveValue("AIの本文");
  });

  it("スマートフォンでも横にスクロールしない：表を使わない（FR-063）", async () => {
    renderAt("/threads/accounts/a1/external-media/p1/peatix");
    await screen.findByRole("region", { name: "ステップ1｜基本情報" });
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelector(".overflow-x-auto")).toBeNull();
  });
});

describe("作業の画面（contracts/ui-routes.md 4）", () => {
  it("STEPのカードと値ごとのコピー。保存も状況の変更もしない。入力の画面に戻れる", async () => {
    const user = userEvent.setup();
    const router = renderAt("/threads/accounts/a1/external-media/p1/peatix?view=work");
    expect(
      await screen.findByText("上から順番にコピーして、Peatixに貼り付けてください。"),
    ).toBeInTheDocument();
    const steps = [
      ...screen
        .getByRole("list", { name: "作業のSTEP" })
        .querySelectorAll<HTMLElement>(":scope > li"),
    ];
    expect(steps).toHaveLength(10);
    expect(within(steps[0]!).getByText("赤の項目はありません")).toBeInTheDocument();
    await user.click(within(steps[2]!).getAllByRole("button", { name: "イベント名をコピー" })[0]!);
    expect(await navigator.clipboard.readText()).toContain("IT交流会");
    expect(within(steps[9]!).getByText(/状況を「掲載済み」にしてください/)).toBeInTheDocument();
    expect(mocks.updateListing).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "入力の画面に戻る" }));
    expect(router.state.location.search).toBe("");
  });
});
