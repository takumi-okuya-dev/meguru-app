// 権限がないトークンの案内（specs/010-token-account-add contracts/ui-routes.md 6、US1-4・US1-5）
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { TokenWarnings } from "@/apps/threads/components/connect/TokenWarnings";

describe("TokenWarnings", () => {
  it("URL の warn を読み、投稿・反応数の案内を出す", () => {
    render(
      <MemoryRouter initialEntries={["/accounts/a1?connected=new&warn=publish,insights"]}>
        <TokenWarnings />
      </MemoryRouter>,
    );
    expect(screen.getByText(/このトークンには投稿の権限がありません/)).toBeInTheDocument();
    expect(screen.getByText(/このトークンには反応数を読む権限がありません/)).toBeInTheDocument();
  });

  it("warn がなければ何も出さない。渡した warnings はそのまま出す", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/accounts/a1"]}>
        <TokenWarnings />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
    render(
      <MemoryRouter>
        <TokenWarnings warnings={["insights"]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/反応数を読む権限がありません/)).toBeInTheDocument();
  });
});
