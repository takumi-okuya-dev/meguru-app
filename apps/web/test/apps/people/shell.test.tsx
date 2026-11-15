// 人物メモの画面の枠（specs/people/001-people-memo tasks.md T022、contracts/ui-routes.md 1、research.md R20）。
// 幅767px以下だけ中身の下に固定の下のバーを出し、今いる画面を濃く出す。768px以上は出さない。
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "../../helpers/billing";
import { resetViewport, setViewport } from "../../helpers/viewport";
import { renderRoutes } from "./helpers";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "たろう", primaryEmailAddress: { emailAddress: "taro@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: async () => ({
        user: { id: "u", email: "taro@example.com", displayName: "たろう" },
        ...ME_BILLING_OFF,
        apps: { available: ["threads", "people"], using: ["people"], last: "people", landing: "people" },
      }),
    },
  };
});

const { PeopleShell } = await import("@/apps/people/shell/PeopleShell");
const { PageHeader } = await import("@/shell");

/**
 * 枠の中に中身を描く。
 * @param path - 開くURL
 */
function renderShell(path: string) {
  const page = (
    <PeopleShell>
      <PageHeader title="画面" />
      <p>中身</p>
    </PeopleShell>
  );
  renderRoutes(
    [
      { path: "/people", element: page },
      { path: "/people/import", element: page },
      { path: "/people/events", element: page },
      { path: "/people/events/new", element: page },
      { path: "/people/list", element: page },
      { path: "/people/list/:personId", element: page },
      { path: "/people/settings", element: page },
    ],
    path,
  );
}

afterEach(() => resetViewport());

describe("下のバー", () => {
  it("767px以下では、中身の下に下のバーを出し、今いる画面（取り込み）を濃く出す", async () => {
    setViewport(390);
    renderShell("/people/import");
    const bar = await screen.findByRole("navigation", { name: "人物メモのメニュー" });
    const links = within(bar).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["誘う候補", "人", "取り込み", "イベント"]);
    expect(within(bar).getByRole("link", { name: "取り込み" })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: "誘う候補" })).not.toHaveAttribute("aria-current");
    expect(within(bar).getByRole("link", { name: "取り込み" }).className).toContain("font-semibold");
    // アプリの切り替えは上部バーの左のボタン（ドロワー）から
    expect(screen.getByRole("button", { name: "メニューを開く" })).toBeInTheDocument();
  });

  it("イベントを作る画面では「イベント」を濃く出す", async () => {
    setViewport(390);
    renderShell("/people/events/new");
    const bar = await screen.findByRole("navigation", { name: "人物メモのメニュー" });
    expect(within(bar).getByRole("link", { name: "イベント" })).toHaveAttribute("aria-current", "page");
  });

  it("768px以上では下のバーを出さない（ほかのアプリと同じサイドバー・ドロワー）", async () => {
    setViewport(768);
    renderShell("/people/import");
    expect(await screen.findByText("中身")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "人物メモのメニュー" })).not.toBeInTheDocument();
  });

  it("人のページでは「人」を濃く出す", async () => {
    setViewport(390);
    renderShell("/people/list/p1");
    const bar = await screen.findByRole("navigation", { name: "人物メモのメニュー" });
    expect(within(bar).getByRole("link", { name: "人" })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: "人" })).toHaveAttribute("href", "/people/list");
  });

  it("ホーム（/people）では「誘う候補」を濃く出す", async () => {
    setViewport(390);
    renderShell("/people");
    const bar = await screen.findByRole("navigation", { name: "人物メモのメニュー" });
    expect(within(bar).getByRole("link", { name: "誘う候補" })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: "誘う候補" })).toHaveAttribute("href", "/people");
    expect(within(bar).getByRole("link", { name: "人" })).not.toHaveAttribute("aria-current");
  });

  it("誘いの文と目標（設定）は下のバーに出さず、どの項目も濃くしない", async () => {
    setViewport(390);
    renderShell("/people/settings");
    const bar = await screen.findByRole("navigation", { name: "人物メモのメニュー" });
    expect(within(bar).queryByRole("link", { name: /誘いの文と目標|設定/ })).not.toBeInTheDocument();
    expect(within(bar).queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });

  it("1024px以上ではサイドバーに誘う候補・人・取り込み・イベントと、下に誘いの文と目標を出す", async () => {
    setViewport(1024);
    renderShell("/people/events");
    const nav = await screen.findByRole("navigation", { name: "人物メモ" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent?.trim())).toEqual(["誘う候補", "人", "取り込み", "イベント", "誘いの文と目標"]);
    expect(within(nav).getByRole("link", { name: "誘いの文と目標" })).toHaveAttribute("href", "/people/settings");
    expect(within(nav).getByRole("link", { name: "イベント" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("navigation", { name: "人物メモのメニュー" })).not.toBeInTheDocument();
  });
});
