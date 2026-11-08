// 押す前の案内（specs/025-threads-account-guide contracts/ui-routes.md 1、US1・FR-001〜FR-003、T002）
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThreadsAccountGuide } from "@/components/connect/ThreadsAccountGuide";

describe("ThreadsAccountGuide", () => {
  it("使うべきアカウントがあれば@名前を出す（太字）", () => {
    render(<ThreadsAccountGuide expected="taku.it.ai" />);
    expect(screen.getByText(/threads.comでログインしているアカウントで許可されます。/)).toBeInTheDocument();
    expect(screen.getByText("@taku.it.ai").tagName).toBe("STRONG");
  });

  it("決まっていなければ前半だけ", () => {
    render(<ThreadsAccountGuide expected={null} />);
    expect(screen.getByText("threads.comでログインしているアカウントで許可されます。")).toBeInTheDocument();
    expect(screen.queryByText(/でログインしているか確かめてください/)).not.toBeInTheDocument();
  });

  it("トグルは初めは閉じていて、開くと3つの手順と threads.com のリンク（新しいタブ）が出る", async () => {
    render(<ThreadsAccountGuide expected="taku.it.ai" />);
    const toggle = screen.getByRole("button", { name: "違うアカウントが出たときは" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/今のアカウントからログアウトする/)).not.toBeInTheDocument();
    await userEvent.setup().click(toggle);
    expect(screen.getByText(/今のアカウントからログアウトする/)).toBeInTheDocument();
    expect(screen.getByText(/@taku.it.ai でログインし直す/)).toBeInTheDocument();
    expect(screen.getByText(/もう一度「Threadsで許可する」を押す/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /threads.comを開く/ });
    expect(link).toHaveAttribute("href", "https://www.threads.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});
