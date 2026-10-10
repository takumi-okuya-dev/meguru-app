// スマートフォンの通知の位置（specs/008-team-operations FR-070、research.md R13、docs/ui-design.md §11）
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const sonnerProps = vi.fn();
vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    sonnerProps(props);
    return null;
  },
}));
vi.mock("@/lib/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
const { Toaster } = await import("@/components/ui/sonner");

describe("Toaster", () => {
  it("767px以下では、ヘッダー（52px）とセーフエリアの下に出し、左右16pxあける。768px以上は上部中央のまま", () => {
    render(<Toaster />);
    const props = sonnerProps.mock.calls.at(-1)![0] as { position: string; mobileOffset: Record<string, string> };
    expect(props.position).toBe("top-center");
    expect(props.mobileOffset).toEqual({
      top: "calc(env(safe-area-inset-top) + 60px)",
      left: "16px",
      right: "16px",
    });
  });
});
