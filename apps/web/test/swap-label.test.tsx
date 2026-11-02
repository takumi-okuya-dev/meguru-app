// 押すと文言が変わるボタンで、幅を変えないための文言（2026-11-02。ボタンが動く不具合）
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SwapLabel } from "@/components/SwapLabel";
import { Button } from "@/components/ui/button";

describe("SwapLabel", () => {
  it("今の文言だけが名前になり、ほかの文言は幅を取るためだけに隠して置く", () => {
    const { rerender } = render(
      <Button>
        <SwapLabel current="コピー" labels={["コピー", "コピーしました"]} />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "コピー" })).toBeInTheDocument();
    expect(screen.getByText("コピーしました")).toHaveAttribute("aria-hidden", "true");

    rerender(
      <Button>
        <SwapLabel current="コピーしました" labels={["コピー", "コピーしました"]} />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "コピーしました" })).toBeInTheDocument();
    expect(screen.getByText("コピー")).toHaveAttribute("aria-hidden", "true");
  });

  it("文言が1つしかなければ、隠す文言を置かない", () => {
    render(<SwapLabel current="保存" labels={["保存", undefined]} />);
    expect(screen.getByText("保存").parentElement?.children).toHaveLength(1);
  });
});
