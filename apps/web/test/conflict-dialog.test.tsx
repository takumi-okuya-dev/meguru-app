// 保存の衝突のダイアログ（specs/002 規則5、specs/008 FR-007）
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConflictDialog } from "@/components/ConflictDialog";

const noop = vi.fn();

describe("ConflictDialog", () => {
  it("先に保存した人が分かれば「（名前）さんが先に保存しました」", () => {
    render(<ConflictDialog open updatedAt={null} updatedByName="佐藤 美咲" onReload={noop} onOverwrite={noop} onCancel={noop} />);
    expect(screen.getByRole("heading", { name: "佐藤 美咲さんが先に保存しました" })).toBeInTheDocument();
  });

  it("分からなければ今の文言", () => {
    render(<ConflictDialog open updatedAt={null} onReload={noop} onOverwrite={noop} onCancel={noop} />);
    expect(screen.getByRole("heading", { name: "他の場所で更新されています" })).toBeInTheDocument();
  });
});
