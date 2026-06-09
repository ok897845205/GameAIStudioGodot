export type OpenPathFn = (targetPath: string) => Promise<string>;

export async function openSystemPath(targetPath: string, openPath: OpenPathFn): Promise<void> {
  const error = await openPath(targetPath);
  if (error) {
    throw new Error(`无法打开路径：${targetPath}\n${error}`);
  }
}
