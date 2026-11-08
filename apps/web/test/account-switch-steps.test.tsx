// 違うアカウントで戻ったときの手順（specs/025-threads-account-guide contracts/ui-routes.md 2、US2・FR-005、T007）
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountSwitchSteps } from "@/components/connect/AccountSwitchSteps";

describe("AccountSwitchSteps", () => {
  it("番号つきの3つの手順（閉じずに出す）と、枠線の「threads.comを開く」（新しいタブ）", () => {
    render(<AccountSwitchSteps expected="taku.it.ai" again="接続し直す" />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "threads.com（またはThreadsのアプリ）で、今のアカウントからログアウトする",
      "@taku.it.ai でログインし直す",
      "このページに戻って、もう一度「接続し直す」を押す",
    ]);
    expect(screen.getByRole("list").tagName).toBe("OL");
    const link = screen.getByRole("link", { name: /threads.comを開く/ });
    expect(link).toHaveAttribute("href", "https://www.threads.com/");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("使うべきアカウントが決まっていなければ「つなぎたいアカウント」", () => {
    render(<AccountSwitchSteps expected={null} again="Threadsで許可する" />);
    expect(screen.getByText("つなぎたいアカウントでログインし直す")).toBeInTheDocument();
  });
});
