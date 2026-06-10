import type { ProjectDetails, PreviewResult, RunAgentTurnInput, RunAgentTurnResult } from "@gameaistudio/shared";
import { shouldRefreshPreviewAfterFileChanges } from "./auto-preview-service";
import type { AgentService } from "./agent-service";
import type { AutoPreviewService } from "./auto-preview-service";
import type { GitService } from "./git-service";
import { getProjectLogger } from "./logger";
import type { ProjectService } from "./project-service";

export interface AgentTurnOrchestratorDependencies {
  agentService: Pick<AgentService, "runTurn">;
  autoPreviewService: Pick<AutoPreviewService, "refresh">;
  gitService?: Pick<GitService, "commit">;
  projectService: Pick<ProjectService, "getProject">;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runAgentTurnWithOptionalPreview(
  deps: AgentTurnOrchestratorDependencies,
  input: RunAgentTurnInput
): Promise<RunAgentTurnResult> {
  const result = await deps.agentService.runTurn(input);
  const lastAgentMessage = [...result.messages].reverse().find((message) => message.role === "agent" && message.agentId === input.agentId);
  const fileChanges = lastAgentMessage?.fileChanges ?? [];
  const shouldAutoSaveGit = Boolean(deps.gitService && lastAgentMessage?.exitCode === 0 && fileChanges.length > 0);
  if (shouldAutoSaveGit) {
    try {
      await deps.gitService!.commit({
        projectId: result.project.id,
        message: `自动保存：${input.agentId} Agent 回合`
      });
    } catch (error) {
      getProjectLogger(result.project.rootPath).warn("git", "Agent 回合自动保存 Git 版本失败", {
        projectId: result.project.id,
        agentId: input.agentId,
        cliToolId: input.cliToolId,
        fileChangeCount: fileChanges.length,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (!input.autoStartPreview || !shouldRefreshPreviewAfterFileChanges(result.project.rootPath, result.project.webBuildPath, fileChanges)) {
    return result;
  }

  try {
    const previewResult: PreviewResult = await deps.autoPreviewService.refresh(result.project.id, fileChanges[0]?.path);
    return {
      ...result,
      project: await deps.projectService.getProject(result.project.id),
      previewResult
    };
  } catch (error) {
    return {
      ...result,
      project: await deps.projectService.getProject(result.project.id).catch(async () => result.project as ProjectDetails),
      previewError: errorMessage(error)
    };
  }
}
