import { describe, expect, it } from "vitest";
import { openSystemPath } from "./system-open-service";

describe("openSystemPath", () => {
  it("resolves when Electron reports an empty openPath error string", async () => {
    await expect(openSystemPath("C:\\projects\\game", async () => "")).resolves.toBeUndefined();
  });

  it("throws a useful error when Electron cannot open the path", async () => {
    await expect(openSystemPath("C:\\missing\\agent-journal.md", async () => "The system cannot find the file specified.")).rejects.toThrow(
      "无法打开路径：C:\\missing\\agent-journal.md"
    );
  });
});
