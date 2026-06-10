import { appendFile, readFile, writeFile } from "node:fs/promises";

export const UTF8_BOM = "\uFEFF";
const UTF8_BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf]);

export function stripUtf8Bom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

export function withUtf8Bom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text : `${UTF8_BOM}${text}`;
}

export async function writeUtf8BomFile(filePath: string, text: string): Promise<void> {
  await writeFile(filePath, withUtf8Bom(text), "utf8");
}

async function hasUtf8Bom(filePath: string): Promise<boolean> {
  try {
    const data = await readFile(filePath);
    return data.subarray(0, UTF8_BOM_BYTES.length).equals(UTF8_BOM_BYTES);
  } catch {
    return false;
  }
}

export async function appendUtf8BomFile(filePath: string, text: string): Promise<void> {
  const prefix = (await hasUtf8Bom(filePath)) ? "" : UTF8_BOM;
  await appendFile(filePath, `${prefix}${text}`, "utf8");
}
