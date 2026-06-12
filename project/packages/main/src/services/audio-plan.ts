import type { AudioKind, AudioPlanItem, GeneratedAudioRecord } from "@gameaistudio/shared";
import { extractJsonSpans } from "./asset-plan";

/** Cost guards: a single workflow round never generates unbounded audio. */
export const MAX_AUDIO_PLAN_ITEMS = 4;
export const MAX_AUDIO_CLIPS = 4;

const VALID_KINDS: AudioKind[] = ["bgm", "sfx", "ambience"];
const MAX_DURATION = 180;

/**
 * Appended to the artist Agent's workflow message when the audio pipeline is
 * on: asks for a machine-readable audio plan (in the same or a separate JSON
 * block) the system turns into real BGM/SFX/ambience clips.
 */
export function buildArtistAudioPlanInstruction(): string {
  return [
    "",
    "本轮还启用了自动音频生成：请在回复末尾再输出一个 ```json 代码块，给出本游戏需要的音频计划，系统会调用文生音频模型生成并放进 assets/audio/。格式：",
    "```json",
    `{"audio": [{"key": "bgm_level", "kind": "bgm", "description": "loopable energetic chiptune for a pixel shooter", "durationSeconds": 45, "loopable": true}, {"key": "sfx_shoot", "kind": "sfx", "description": "short retro laser shot", "durationSeconds": 1}]}`,
    "```",
    "规则：",
    `- 最多 ${MAX_AUDIO_PLAN_ITEMS} 项；key 用小写英文+下划线，会成为音频槽位名（如 bgm.main、sfx.jump、ambience.forest）。`,
    `- kind 只能取：${VALID_KINDS.join(" / ")}。description 用英文描述声音本身。`,
    "- BGM 建议 loopable=true 且 30-60 秒；SFX 1-2 秒；环境音建议无缝循环。",
    "- 只规划核心音频：1 首主 BGM + 几个关键 SFX，不要贪多。"
  ].join("\n");
}

function sanitizeKey(value: unknown, index: number): string {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return key || `audio_${index + 1}`;
}

function coerceItem(raw: unknown, index: number): AudioPlanItem | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const description = String(source.description ?? source.prompt ?? "").trim();
  if (!description) return undefined;
  // Require an explicit audio kind — otherwise an image asset array (which has
  // `purpose`, not `kind`) would be misread as audio.
  if (!VALID_KINDS.includes(source.kind as AudioKind)) return undefined;
  const kind = source.kind as AudioKind;
  const durationRaw = Number(source.durationSeconds ?? source.duration);
  const durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.min(Math.round(durationRaw), MAX_DURATION) : undefined;
  return {
    key: sanitizeKey(source.key, index),
    kind,
    description: description.slice(0, 400),
    durationSeconds,
    loopable: source.loopable === true || kind === "bgm" || kind === "ambience"
  };
}

/**
 * Extracts the audio plan from an artist Agent reply. Tolerant: the reply may
 * hold one JSON object with both `assets` and `audio`, a separate block, or a
 * bare array. Returns [] when nothing parseable is found.
 */
export function parseAudioPlan(content: string): AudioPlanItem[] {
  const candidates: string[] = [];
  for (const match of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(match[1] ?? "");
  }
  candidates.push(content);

  for (const candidate of candidates) {
    for (const span of extractJsonSpans(candidate)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(span);
      } catch {
        continue;
      }
      const rawItems = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { audio?: unknown[] }).audio)
          ? (parsed as { audio: unknown[] }).audio
          : undefined;
      if (!rawItems) continue;
      const items = rawItems
        .map((item, index) => coerceItem(item, index))
        .filter((item): item is AudioPlanItem => Boolean(item))
        .slice(0, MAX_AUDIO_PLAN_ITEMS);
      const seen = new Set<string>();
      for (const item of items) {
        while (seen.has(item.key)) item.key = `${item.key}_2`;
        seen.add(item.key);
      }
      // Only treat as an audio plan if items carry an audio kind — a bare
      // array of image assets shouldn't be mistaken for audio.
      if (items.length > 0 && items.some((item) => VALID_KINDS.includes(item.kind))) {
        return items;
      }
    }
  }
  return [];
}

export interface AudioPipelineOutcome {
  planItems: AudioPlanItem[];
  generated: Array<{ item: AudioPlanItem; record: GeneratedAudioRecord }>;
  failed: Array<{ item: AudioPlanItem; error: string }>;
}

export function describeAudioPipelineOutcome(outcome: AudioPipelineOutcome): string[] {
  const lines: string[] = [];
  for (const entry of outcome.generated) {
    lines.push(`- ${entry.record.resPath}（slot: ${entry.item.key}）— ${entry.item.description.slice(0, 70)}`);
  }
  for (const failure of outcome.failed) {
    lines.push(`- ✗ ${failure.item.key} 生成失败：${failure.error.slice(0, 140)}`);
  }
  return lines;
}

/** Note injected into the programmer/QA workflow messages about the audio. */
export function buildAudioPipelineNote(outcome: AudioPipelineOutcome | undefined, role: "programmer" | "qa" = "programmer"): string {
  if (!outcome || outcome.planItems.length === 0) {
    return role === "qa"
      ? "音频验收：本轮没有自动生成音频，确认游戏在无音频时也能正常运行即可。"
      : "音频说明：本轮没有自动生成音频。无需强行加音频，保持游戏可玩。";
  }
  const lines: string[] =
    role === "qa"
      ? [
          "音频验收：本轮 AI 已生成以下音频并放入项目。检查 BGM 是否在合适场景播放、SFX 是否被对应事件触发、循环是否突兀；有未接入的音频则 QA结论为「发现问题」并列出："
        ]
      : [
          "音频说明：本轮 AI 已生成以下音频，请用 AudioStreamPlayer / AudioStreamPlayer2D 接入这些 res:// 路径（BGM 设 loop，SFX 在事件处播放）："
        ];
  for (const entry of outcome.generated) {
    lines.push(`- ${entry.item.key}（${entry.item.kind}）→ ${entry.record.resPath}`);
  }
  if (outcome.failed.length > 0) {
    lines.push("以下音频生成失败，可暂时省略并在回复中标注缺失：");
    for (const failure of outcome.failed) {
      lines.push(`- ${failure.item.key}（${failure.item.description.slice(0, 50)}）`);
    }
  }
  return lines.join("\n");
}
