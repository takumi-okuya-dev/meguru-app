// 集金管理のイベントの入力欄（specs/collect/001-event-day-collection FR-010、tasks.md T029）。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventForm } from "@/apps/collect/components/EventForm";

describe("イベントの入力欄", () => {
  it("金額が空の区分は、0円にせず入力の誤りにする。全角の数字は受ける", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventForm submitLabel="作る" pending={false} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("イベント名"), "IT交流会");
    await user.type(screen.getByLabelText("開催日"), "2026-11-20");
    await user.click(screen.getByRole("button", { name: "作る" }));
    expect(screen.getByRole("alert")).toHaveTextContent("金額は0〜999,999円");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("区分1の金額"), "３，０００");
    await user.click(screen.getByRole("button", { name: "作る" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z", endsAt: "2026-11-20T12:00:00.000Z", tiers: [{ name: "通常", amount: 3000 }] }),
    );
  });

  it("終わりが始まりより前なら、次の日の時刻にする", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventForm submitLabel="作る" pending={false} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("イベント名"), "夜の会");
    await user.type(screen.getByLabelText("開催日"), "2026-11-20");
    const end = screen.getByLabelText("終わり（任意）");
    await user.clear(end);
    await user.type(end, "01:00");
    await user.type(screen.getByLabelText("区分1の金額"), "0");
    await user.click(screen.getByRole("button", { name: "作る" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ startsAt: "2026-11-20T10:00:00.000Z", endsAt: "2026-11-20T16:00:00.000Z" }));
  });
});
