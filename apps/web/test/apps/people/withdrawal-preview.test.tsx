// 退会の確かめの人物メモの分（specs/people/001-people-memo tasks.md T046、research.md R19）。
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const me = vi.fn();
vi.mock("@/apps/people/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/apps/people/lib/api")>();
  return { ...actual, peopleApi: { ...actual.peopleApi, me } };
});

const { peopleApp } = await import("@/apps/people");

describe("退会の確かめ", () => {
  it("GET /api/people/me の数で「人物メモ：人 n人・イベント n件が消えます」を出す", async () => {
    me.mockResolvedValue({ personCount: 32, eventCount: 2 });
    const preview = peopleApp.withdrawalPreview!;
    const data = await preview.query.queryFn();
    expect(me).toHaveBeenCalled();
    render(<preview.Section data={data} />);
    expect(screen.getByText("人物メモ：人 32人・イベント 2件が消えます")).toBeInTheDocument();
  });

  it("まだ何もなくても、0の数で出す", async () => {
    me.mockResolvedValue({ personCount: 0, eventCount: 0 });
    const preview = peopleApp.withdrawalPreview!;
    render(<preview.Section data={await preview.query.queryFn()} />);
    expect(screen.getByText("人物メモ：人 0人・イベント 0件が消えます")).toBeInTheDocument();
  });
});
