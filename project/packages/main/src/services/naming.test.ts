import { describe, expect, it } from "vitest";
import { sanitizeProjectName } from "./naming";

describe("sanitizeProjectName", () => {
  it("keeps readable names while removing unsafe path characters", () => {
    expect(sanitizeProjectName("黄金矿工: 2D/3D?")).toBe("黄金矿工-2D-3D");
  });

  it("falls back when the name is empty", () => {
    expect(sanitizeProjectName("  <>  ")).toBe("game-project");
  });

  it("avoids Windows reserved device names", () => {
    expect(sanitizeProjectName("con")).toBe("con-project");
  });
});


describe("createProjectDirectoryName", () => {
  it("builds an ASCII-only CLI-safe directory name from dimension and timestamp", async () => {
    const { createProjectDirectoryName } = await import("./naming");
    const name = createProjectDirectoryName("2d", new Date(2026, 5, 11, 10, 30, 45));
    expect(name).toBe("2D_game_20260611103045");
    expect(/^[\x20-\x7e]+$/.test(name)).toBe(true);
    expect(createProjectDirectoryName("3d", new Date(2026, 0, 2, 3, 4, 5))).toBe("3D_game_20260102030405");
  });
});
