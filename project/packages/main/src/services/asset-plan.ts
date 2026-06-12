import type {
  AssetPlanItem,
  GeneratedAssetAspect,
  GeneratedAssetPurpose,
  GeneratedAssetRecord
} from "@gameaistudio/shared";

/** Cost guards: a single workflow round never generates unbounded images. */
export const MAX_PLAN_ITEMS = 6;
export const MAX_PLAN_IMAGES = 8;
const MAX_COUNT_PER_ITEM = 2;

const VALID_PURPOSES: GeneratedAssetPurpose[] = [
  "character",
  "enemy",
  "prop",
  "background",
  "ui-icon",
  "ui-button",
  "logo",
  "cover",
  "promo",
  "other"
];

const VALID_ASPECTS: GeneratedAssetAspect[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];

/**
 * Appended to the artist Agent's workflow message when the asset pipeline is
 * on: demands a machine-readable plan the system can turn into real images.
 */
export function buildArtistAssetPlanInstruction(): string {
  return [
    "",
    "本轮启用了自动素材生成：除了视觉方向说明，你必须在回复末尾输出一个 ```json 代码块，给出本游戏需要自动生成的图片素材计划，系统会逐项调用生图模型并把成品放进项目 assets/ 目录。格式：",
    "```json",
    `{"assets": [{"key": "player_ship", "description": "side-view spaceship for a horizontal shooter, single sprite", "purpose": "character", "style": "pixel art", "transparentBackground": true, "count": 1}]}`,
    "```",
    "规则：",
    `- 最多 ${MAX_PLAN_ITEMS} 项；key 用小写英文+下划线，会成为素材槽位名（如 player_ship、enemy_basic、background_main、coin_icon）。`,
    "- description 用英文写生成提示词，描述单个对象/画面，不要包含文字内容。",
    `- purpose 只能取：${VALID_PURPOSES.join(" / ")}。`,
    `- aspectRatio 可选：${VALID_ASPECTS.join(" / ")}（背景建议 16:9）。角色/道具/图标建议 "transparentBackground": true。`,
    `- count 是该项生成张数（1-${MAX_COUNT_PER_ITEM}）。`,
    "- 只规划本轮必需的核心素材（主角、敌人、背景、关键 UI），不要贪多。"
  ].join("\n");
}

function sanitizeKey(value: unknown, index: number): string {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return key || `asset_${index + 1}`;
}

function coerceItem(raw: unknown, index: number): AssetPlanItem | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const description = String(source.description ?? source.prompt ?? "").trim();
  if (!description) return undefined;
  const purpose = VALID_PURPOSES.includes(source.purpose as GeneratedAssetPurpose)
    ? (source.purpose as GeneratedAssetPurpose)
    : "other";
  const aspectRatio = VALID_ASPECTS.includes(source.aspectRatio as GeneratedAssetAspect)
    ? (source.aspectRatio as GeneratedAssetAspect)
    : undefined;
  const countRaw = Number(source.count ?? 1);
  const count = Number.isFinite(countRaw) ? Math.min(Math.max(Math.round(countRaw), 1), MAX_COUNT_PER_ITEM) : 1;
  return {
    key: sanitizeKey(source.key, index),
    description: description.slice(0, 600),
    purpose,
    style: typeof source.style === "string" && source.style.trim() ? source.style.trim().slice(0, 120) : undefined,
    aspectRatio,
    transparentBackground: source.transparentBackground === true,
    count
  };
}

/**
 * Extracts the asset plan from an artist Agent reply. Tolerant by design —
 * agents wrap JSON in prose, fences, or emit a bare array. Returns [] when
 * nothing parseable is found (the workflow then degrades to placeholders).
 */
export function parseAssetPlan(content: string): AssetPlanItem[] {
  const candidates: string[] = [];
  for (const match of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(match[1] ?? "");
  }
  candidates.push(content);

  for (const candidate of candidates) {
    // The reply may hold several JSON-ish spans; try the widest object/array.
    for (const span of extractJsonSpans(candidate)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(span);
      } catch {
        continue;
      }
      const rawItems = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { assets?: unknown[] }).assets)
          ? (parsed as { assets: unknown[] }).assets
          : undefined;
      if (!rawItems) continue;
      const items = rawItems
        .map((item, index) => coerceItem(item, index))
        .filter((item): item is AssetPlanItem => Boolean(item))
        .slice(0, MAX_PLAN_ITEMS);
      // De-duplicate keys so two plan rows never fight over one slot.
      const seen = new Set<string>();
      for (const item of items) {
        while (seen.has(item.key)) item.key = `${item.key}_2`;
        seen.add(item.key);
      }
      if (items.length > 0) return items;
    }
  }
  return [];
}

export function extractJsonSpans(text: string): string[] {
  const spans: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    spans.push(trimmed);
  }
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    spans.push(text.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    spans.push(text.slice(arrayStart, arrayEnd + 1));
  }
  return spans;
}

export interface AssetPipelineOutcome {
  planItems: AssetPlanItem[];
  generated: Array<{ item: AssetPlanItem; records: GeneratedAssetRecord[] }>;
  failed: Array<{ item: AssetPlanItem; error: string }>;
}

/** Lines for the run-step output / chat message describing what was produced. */
export function describeAssetPipelineOutcome(outcome: AssetPipelineOutcome): string[] {
  const lines: string[] = [];
  for (const entry of outcome.generated) {
    for (const [index, record] of entry.records.entries()) {
      lines.push(`- ${record.resPath}${index === 0 ? `（slot: ${entry.item.key}）` : "（备选）"} — ${entry.item.description.slice(0, 80)}`);
    }
  }
  for (const failure of outcome.failed) {
    lines.push(`- ✗ ${failure.item.key} 生成失败：${failure.error.slice(0, 160)}`);
  }
  return lines;
}

/**
 * Context note appended to the programmer / QA workflow messages so the
 * downstream rounds actually use the generated art (or knowingly fall back to
 * placeholders for the missing pieces). The QA variant turns the list into an
 * acceptance checklist: unused generated assets count as a finding, which
 * routes the workflow into the fix round.
 */
export function buildAssetPipelineNote(outcome: AssetPipelineOutcome | undefined, role: "programmer" | "qa" = "programmer"): string {
  if (!outcome || outcome.planItems.length === 0) {
    return role === "qa"
      ? "素材验收：本轮没有自动生成图片素材，确认游戏使用了代码绘制的占位图形且画面可辨认即可。"
      : "素材说明：本轮没有自动生成图片素材。需要视觉元素时先用代码绘制的占位图形（ColorRect/Polygon2D 等），保持游戏可玩。";
  }
  const lines: string[] =
    role === "qa"
      ? [
          "素材验收：本轮 AI 已生成以下图片素材并放入项目。逐项检查它们是否真的被场景/脚本引用、是否会出现在 Web 预览画面中；只要有素材未被使用，QA结论必须是「发现问题」并列出未使用项："
        ]
      : ["素材说明：本轮 AI 已自动生成以下图片并放入项目，必须直接用这些 res:// 路径接入场景（不要再自创占位图替代它们）："];
  for (const entry of outcome.generated) {
    const record = entry.records[0];
    if (record) {
      lines.push(`- ${entry.item.key} → ${record.resPath}`);
    }
  }
  if (outcome.failed.length > 0) {
    lines.push(
      role === "qa"
        ? "以下素材生成失败，应由占位图形顶替（缺占位也算问题）："
        : "以下素材生成失败，先用代码绘制的占位图形顶替，并在回复中明确标注缺失项："
    );
    for (const failure of outcome.failed) {
      lines.push(`- ${failure.item.key}（${failure.item.description.slice(0, 60)}）`);
    }
  }
  return lines.join("\n");
}
