import { describe, expect, it } from "vitest";
import type { StudioProject } from "@gameaistudio/shared";
import { pickBootstrapProjectId } from "./project-selection";

function project(id: string): StudioProject {
  return {
    id,
    name: id,
    dimension: "2d",
    prompt: "demo",
    rootPath: `E:/projects/${id}`,
    webBuildPath: `E:/projects/${id}/build/web`,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    activeAgentId: "producer"
  };
}

describe("pickBootstrapProjectId", () => {
  it("returns undefined when there are no projects", () => {
    expect(pickBootstrapProjectId([], "missing", "also-missing")).toBeUndefined();
  });

  it("keeps a requested project when it exists", () => {
    expect(pickBootstrapProjectId([project("a"), project("b")], "b", "a")).toBe("b");
  });

  it("falls back to the current project or first project when stale ids are provided", () => {
    expect(pickBootstrapProjectId([project("a"), project("b")], "missing", "b")).toBe("b");
    expect(pickBootstrapProjectId([project("a"), project("b")], "missing", "also-missing")).toBe("a");
  });
});
