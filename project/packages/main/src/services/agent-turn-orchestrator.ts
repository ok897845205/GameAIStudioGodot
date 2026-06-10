import type { ProjectDetails, PreviewResult, RunAgentTurnInput, RunAgentTurnResult } from "@gameaistudio/shared";
import { shouldRefreshPreviewAfterFileChanges } from "./auto-preview-service";
import type { AgentService } from "./agent-service";
import type { AutoPreviewService } from "./auto-preview-service";
import type { GitService } from "./git-service";
import { getProjectLogger } from "./logger";
import { createMessageId } from "./naming";
import type { ProjectService } from "./project-service";

export interface AgentTurnOrchestratorDependencies {
  agentService: Pick<AgentService, "runTurn">;
  autoPreviewService: Pick<AutoPreviewService, "refresh">;
  gitService?: Pick<GitService, "commit">;
  projectService: Pick<ProjectService, "getProject" | "appendMessages">;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runAgentTurnWithOptionalPreview(
  deps: AgentTurnOrchestratorDependencies,
  input: RunAgentTurnInput
): Promise<RunAgentTurnResult> {
  let result = await deps.agentService.runTurn(input);
  const lastAgentMessage = [...result.messages].reverse().find((message) => message.role === "agent" && message.agentId === input.agentId);
  const fileChanges = lastAgentMessage?.fileChanges ?? [];
  const shouldAutoSaveGit = Boolean(deps.gitService && lastAgentMessage?.exitCode === 0 && fileChanges.length > 0);
  if (shouldAutoSaveGit) {
    try {
      const commitMessage = `自动保存：${input.agentId} Agent 回合`;
      await deps.gitService!.commit({
        projectId: result.project.id,
        message: commitMessage
      });
      // Surface the auto-save in the chat itself (kind "git") so the user sees
      // version checkpoints inline without opening the Git tab.
      const messages = await deps.projectService.appendMessages(result.project.id, [
        {
          id: createMessageId(),
          projectId: result.project.id,
          agentId: input.agentId,
          role: "system",
          kind: "git",
          turnId: lastAgentMessage?.turnId,
          content: `已自动保存 Git 版本（${fileChanges.length} 个文件变更）：${commitMessage}`,
          createdAt: new Date().toISOString()
        }
      ]);
      result = { ...result, messages };
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
