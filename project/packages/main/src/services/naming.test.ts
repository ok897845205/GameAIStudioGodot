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

