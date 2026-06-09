import type { StudioProject } from "@gameaistudio/shared";

export function pickBootstrapProjectId(
  projects: StudioProject[],
  requestedProjectId?: string,
  currentProjectId?: string
): string | undefined {
  const projectIds = new Set(projects.map((project) => project.id));
  if (requestedProjectId && projectIds.has(requestedProjectId)) {
    return requestedProjectId;
  }
  if (currentProjectId && projectIds.has(currentProjectId)) {
    return currentProjectId;
  }
  return projects[0]?.id;
}
