// 人物メモのルートと利用の許可（specs/people/001-people-memo tasks.md T023、contracts/ui-routes.md 1）。
// 許可がない人（/api/me の available に people がない、またはAPIが 403 APP_NOT_AVAILABLE）には「使えない」画面を出す。
import type { MeResponse } from "@meguru/shared";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ME_BILLING_OFF } from "../../helpers/billing";
import { renderRoutes } from "./helpers";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { fullName: "たろう", primaryEmailAddress: { emailAddress: "taro@example.com" } } }),
  useClerk: () => ({ signOut: vi.fn() }),
}));
let available: string[] = ["threads", "people"];
vi.mock("@/lib/api-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: async (): Promise<MeResponse> => ({
        user: { id: "u", email: "taro@example.com", displayName: "たろう" },
        ...ME_BILLING_OFF,
        apps: { available, using: available, last: null, landing: available[0] ?? null },
      }),
    },
  };
});
const events = vi.fn();
const home = {
  stats: vi.fn(async () => ({ repeaterCount: 0, repeaterGoal: null, nextOwnEvent: null })),
  settings: vi.fn(async () => ({ inviteTemplate: null, repeaterGoal: null })),
  candidates: vi.fn(async () => ({ persons: [], total: 0 })),
  facets: vi.fn(async () => ({ nextAttendance: [], wantedConnections: [], careerInterests: [] })),
  home: vi.fn(async () => ({ today: [], overdue: [], birthdays: [] })),
  tags: vi.fn(async () => []),
  fields: vi.fn(async () => []),
};
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, events, ...home } };
});

const { ApiError } = await import("@/lib/api-client");
const { peopleApp } = await import("@/apps/people");
const { appById } = await import("@meguru/shared");

beforeEach(() => {
  available = ["threads", "people"];
  events.mockReset();
  events.mockResolvedValue([]);
});

describe("人物メモの入口", () => {
  it("id・basePath・アイコン・使い始めの行き先は、取り決めとアプリの一覧どおり", () => {
    expect(peopleApp.id).toBe("people");
    expect(peopleApp.basePath).toBe("/people");
    expect(peopleApp.startPath).toBe("/people/import");
    expect(appById(peopleApp.id)?.basePath).toBe(peopleApp.basePath);
    expect(peopleApp.withdrawalPreview).toBeDefined();
  });
});

describe("利用の許可", () => {
  it("許可のある人には、ホームに誘う候補を出す。同意した人がまだいなければ取り込みへ案内する", async () => {
    renderRoutes(peopleApp.routes, "/people");
    expect(await screen.findByRole("heading", { name: "誘う候補" })).toBeInTheDocument();
    expect(await screen.findByText(/個別の案内に同意した人が、まだいません/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "アンケートを取り込む" })).toHaveAttribute("href", "/people/import");
  });

  it("/people/settings に誘いの文と目標の画面を出す", async () => {
    renderRoutes(peopleApp.routes, "/people/settings");
    expect(await screen.findByRole("heading", { name: "誘いの文と目標" })).toBeInTheDocument();
  });

  it("/api/me の available に people がない人には、どの画面も「使えない」画面にする", async () => {
    available = ["threads"];
    renderRoutes(peopleApp.routes, "/people/import");
    expect(await screen.findByRole("heading", { name: "このアプリは今は使えません。" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "すべてのアプリへ" })).toHaveAttribute("href", "/apps");
    expect(screen.queryByText("取り込み")).not.toBeInTheDocument();
  });

  it("開いている間にAPIが 403 APP_NOT_AVAILABLE を返したら、「使えない」画面に替える", async () => {
    events.mockRejectedValue(new ApiError("APP_NOT_AVAILABLE", 403));
    renderRoutes(peopleApp.routes, "/people/events");
    expect(await screen.findByRole("heading", { name: "このアプリは今は使えません。" })).toBeInTheDocument();
  });
});
