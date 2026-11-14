// 押すと文言が変わるボタンで、幅を変えないための文言（2026-11-02。ボタンが動く不具合）
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SwapLabel } from "@/components/SwapLabel";
import { Button } from "@/components/ui/button";

const labels = { idle: "コピー", done: "コピーしました" };

describe("SwapLabel", () => {
  it("今の文言だけが名前になり、ほかの文言は幅を取るためだけに隠して置く", () => {
    const { rerender } = render(
      <Button>
        <SwapLabel labels={labels} show="idle" />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "コピー" })).toBeInTheDocument();
    expect(screen.getByText("コピーしました")).toHaveAttribute("aria-hidden", "true");

    rerender(
      <Button>
        <SwapLabel labels={labels} show="done" />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "コピーしました" })).toBeInTheDocument();
    expect(screen.getByText("コピー")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("CopyPromptButton の結果の文", () => {
  it("読み上げの知らせは先に置いておき、コピーできたら文だけを入れる", async () => {
    const { CopyPromptButton } = await import("@/apps/threads/components/CopyPromptButton");
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<CopyPromptButton getText={() => "プロンプト"} copiedMessage="コピーしました。送ってください" />);
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    await user.click(screen.getByRole("button", { name: "プロンプトをコピーする" }));
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("コピーしました。送ってください");
  });
});
