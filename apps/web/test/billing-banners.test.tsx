// 無料体験の終わりの帯と、読むだけの帯（specs/013-billing FR-045・FR-046、contracts/ui-routes.md「帯」、T021・T037）
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jstToday } from "@threads-grower/shared";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ReadOnlyBanner } from "@/components/billing/ReadOnlyBanner";
import { TrialEndingBanner } from "@/components/billing/TrialEndingBanner";
import { meBilling } from "./helpers/billing";

const renderIn = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("無料体験の終わりの帯", () => {
  beforeEach(() => localStorage.clear());

  it("残り7日から出し、8日なら出さない", () => {
    const { unmount } = renderIn(<TrialEndingBanner billing={meBilling("trial", { trialDaysLeft: 8 })} />);
    expect(screen.queryByText(/無料体験はあと/)).not.toBeInTheDocument();
    unmount();
    renderIn(<TrialEndingBanner billing={meBilling("trial", { trialDaysLeft: 7 })} />);
    expect(screen.getByText("無料体験はあと7日で終わります。続けて使うには契約してください。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "契約する" })).toHaveAttribute("href", "/settings/billing");
  });

  it("0日なら「今日で終わります」", () => {
    renderIn(<TrialEndingBanner billing={meBilling("trial", { trialDaysLeft: 0 })} />);
    expect(screen.getByText("無料体験は今日で終わります。続けて使うには契約してください。")).toBeInTheDocument();
  });

  it("契約済み・料金なし・決済OFF・読むだけには出さない", () => {
    for (const state of ["subscribed_trial", "active", "exempt", "billing_disabled", "read_only"] as const) {
      const { unmount } = renderIn(<TrialEndingBanner billing={meBilling(state, { trialDaysLeft: 3 })} />);
      expect(screen.queryByText(/無料体験/), state).not.toBeInTheDocument();
      unmount();
    }
  });

  it("閉じると、その日（日本時間）は出さない", async () => {
    const { unmount } = renderIn(<TrialEndingBanner billing={meBilling("trial", { trialDaysLeft: 3 })} />);
    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByText(/無料体験はあと/)).not.toBeInTheDocument();
    expect(localStorage.getItem(`trial-banner-dismissed:${jstToday(new Date())}`)).toBe("1");
    unmount();
    renderIn(<TrialEndingBanner billing={meBilling("trial", { trialDaysLeft: 3 })} />);
    expect(screen.queryByText(/無料体験はあと/)).not.toBeInTheDocument();
  });
});

describe("読むだけの帯", () => {
  it.each([
    ["trial_ended", "無料体験が終わりました。今は読むだけです。契約すると、すぐに元どおり使えます。", "契約する"],
    ["canceled", "契約が終わりました。今は読むだけです。契約すると、すぐに元どおり使えます。", "契約する"],
    ["payment_failed", "支払いに失敗しました。カードを更新してください。更新するまで読むだけです。", "支払いの画面を開く"],
  ] as const)("オーナー（%s）：理由とボタン", (reason, text, button) => {
    renderIn(<ReadOnlyBanner reason={reason} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: button })).toHaveAttribute("href", "/settings/billing");
  });

  it("チームの人（owner_inactive）：支払いの詳細もボタンも出さず、閉じられない", () => {
    renderIn(<ReadOnlyBanner reason="owner_inactive" />);
    expect(screen.getByText("オーナーの契約の状態により、このアカウントは今、読むだけです。")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
