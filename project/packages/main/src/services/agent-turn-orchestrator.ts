import type { ProjectDetails, PreviewResult, RunAgentTurnInput, RunAgentTurnResult } from "@gameaistudio/shared";
import { shouldRefreshPreviewAfterFileChanges } from "./auto-preview-service";
import type { AgentService } from "./agent-service";
import type { AutoPreviewService } from "./auto-preview-service";
import type { ProjectService } from "./project-service";

export interface AgentTurnOrchestratorDependencies {
  agentService: Pick<AgentService, "runTurn">;
  autoPreviewService: Pick<AutoPreviewService, "refresh">;
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
