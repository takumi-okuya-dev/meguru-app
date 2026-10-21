// 環境の帯（specs/015-deploy-environments FR-040〜FR-042、contracts/ui-routes.md 1、T014）
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvBanner } from "@/components/layout/EnvBanner";
import { ReadOnlyBanner } from "@/components/billing/ReadOnlyBanner";

/** VITE_APP_ENV を差し替えて描く。 */
function renderWith(appEnv: string | undefined, ui?: React.ReactNode) {
  vi.stubEnv("VITE_APP_ENV", appEnv as string);
  return render(
    <MemoryRouter>
      <EnvBanner />
      {ui}
    </MemoryRouter>,
  );
}

const STAGING_TEXT =
  "テスト環境です。本番のデータではありません。ここでの投稿は、つないだThreadsアカウントに実際に投稿されます";

afterEach(() => vi.unstubAllEnvs());

describe("環境の帯", () => {
  it("staging では、テスト環境だと分かる文言を出す", () => {
    renderWith("staging");
    expect(screen.getByText(STAGING_TEXT)).toBeInTheDocument();
  });

  it("development では、開発環境だと分かる文言を出す", () => {
    renderWith("development");
    expect(screen.getByText("開発環境です（手元）")).toBeInTheDocument();
  });

  it("production では出さない", () => {
    const { container } = renderWith("production");
    expect(container).toBeEmptyDOMElement();
  });

  it("知らない値・未設定でも、本番の文言を出さない（黙って本番の見た目にしない）", () => {
    for (const value of [undefined, "", "prod"]) {
      const { container, unmount } = renderWith(value);
      expect(container.textContent, String(value)).toContain("環境");
      unmount();
    }
  });

  it("閉じるボタンを持たない（ずっと出す）", () => {
    renderWith("staging");
    expect(screen.queryByRole("button", { name: "閉じる" })).not.toBeInTheDocument();
  });

  it("ほかの帯（読むだけ）より上に出る", () => {
    renderWith("staging", <ReadOnlyBanner reason="trial_ended" />);
    const env = screen.getByText(STAGING_TEXT);
    const readOnly = screen.getByText(/無料体験が終わりました/);
    // 先に出ているほうが上（DOCUMENT_POSITION_FOLLOWING = 4）
    expect(env.compareDocumentPosition(readOnly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
