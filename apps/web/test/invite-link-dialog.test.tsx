// 招待リンクのダイアログ（specs/008-team-operations research.md R5・R6）
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InviteLinkDialog } from "@/components/team/InviteLinkDialog";

const URL = "http://localhost:5173/invite/e_" + "c".repeat(43);

function renderDialog() {
  const onRotate = vi.fn();
  render(
    <InviteLinkDialog title="編集者を招待" description="説明" url={URL} qrNote="QRの説明" onRotate={onRotate} onClose={vi.fn()} />,
  );
  return { onRotate };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
});

describe("InviteLinkDialog", () => {
  it("コピーすると「コピーしました」。QRコードとリンクの文字列を並べて出す", async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByLabelText("招待リンク")).toHaveValue(URL);
    expect(screen.getByRole("img", { name: "招待リンクのQRコード" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "コピー" }));
    expect(await navigator.clipboard.readText()).toBe(URL);
    expect(screen.getByRole("button", { name: "コピーしました" })).toBeInTheDocument();
  });

  it("端末の共有機能がないときは「送る」を出さず、あるときだけ出す", async () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: "送る" })).not.toBeInTheDocument();
  });

  it("端末の共有機能があれば「送る」でURLを渡す", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: URL }));
  });

  it("「リンクを作り直す」で onRotate を呼ぶ", async () => {
    const user = userEvent.setup();
    const { onRotate } = renderDialog();
    await user.click(screen.getByRole("button", { name: "リンクを作り直す" }));
    expect(onRotate).toHaveBeenCalled();
  });
});
