import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2, Music, Pause, Play, Plus, RefreshCw, Repeat, Trash2, Volume2, Waves } from "lucide-react";
import type {
  AudioGenerationSettings,
  AudioKind,
  GenerateAudioInput,
  GenerateAudioResult,
  GeneratedAudioRecord,
  MediaProviderTestResult,
  StudioProject
} from "@gameaistudio/shared";
import { AUDIO_KIND_LABELS } from "@gameaistudio/shared";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

const inputClass = "h-8 rounded-md border border-border bg-background px-2 text-xs";
const selectClass = "h-8 rounded-md border border-border bg-background px-1.5 text-xs";

function errText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

const KIND_TABS: Array<{ id: AudioKind; label: string; icon: React.ReactNode }> = [
  { id: "bgm", label: "BGM 背景音乐", icon: <Music className="size-3.5" /> },
  { id: "sfx", label: "SFX 音效", icon: <Volume2 className="size-3.5" /> },
  { id: "ambience", label: "环境音", icon: <Waves className="size-3.5" /> }
];

const BGM_USES = ["主菜单", "战斗", "关卡", "胜利", "失败"];
const SFX_USES = ["跳跃", "攻击", "受击", "拾取金币", "按钮点击", "爆炸"];
const AMBIENCE_USES = ["森林", "雨声", "风声", "城市", "地下城"];

const BGM_STYLES = ["", "chiptune 8-bit", "orchestral", "synthwave", "lo-fi", "rock", "ambient electronic"];
const BGM_MOODS = ["", "energetic", "calm", "tense", "triumphant", "melancholic", "mysterious"];
const SLOT_SUGGESTIONS = ["bgm.main", "bgm.battle", "bgm.victory", "sfx.jump", "sfx.hit", "sfx.coin", "sfx.click", "ambience.forest", "ambience.rain"];

interface DraftState {
  prompt: string;
  use: string;
  // bgm
  style: string;
  mood: string;
  durationSeconds: number;
  loopable: boolean;
  bpm: number;
  instrumental: boolean;
  hasLyrics: boolean;
  // sfx
  intensity: "soft" | "medium" | "strong";
  dry: boolean;
  // ambience
  ambienceKeywords: string;
  seamlessLoop: boolean;
}

const initialDraft: DraftState = {
  prompt: "",
  use: "",
  style: "",
  mood: "",
  durationSeconds: 30,
  loopable: true,
  bpm: 0,
  instrumental: true,
  hasLyrics: false,
  intensity: "medium",
  dry: false,
  ambienceKeywords: "",
  seamlessLoop: true
};

/** 音频生成面板（音频 Tab 内容）：BGM / SFX / 环境音 三模式。 */
export function AudioGeneratePanel({ project, onNotice }: { project?: StudioProject; onNotice: (text: string) => void }) {
  const [kind, setKind] = useState<AudioKind>("bgm");
  const [draft, setDraft] = useState<DraftState>(initialDraft);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateAudioResult>();
  const [settings, setSettings] = useState<AudioGenerationSettings>();

  useEffect(() => {
    void window.studio
      .getAudioSettings()
      .then(setSettings)
      .catch((error) => onNotice(errText(error)));
  }, [onNotice]);

  // Clear the previous project's generation result when the project changes.
  const projectId = project?.id;
  useEffect(() => {
    setResult(undefined);
  }, [projectId]);

  const update = (patch: Partial<DraftState>) => setDraft((cur) => ({ ...cur, ...patch }));

  const uses = kind === "bgm" ? BGM_USES : kind === "sfx" ? SFX_USES : AMBIENCE_USES;
  const hasProvider = (settings?.providers ?? []).some((provider) => provider.enabled && provider.hasApiKey);

  const generate = async () => {
    if (!project) {
      onNotice("请先选择一个项目，生成的音频会保存进项目目录。");
      return;
    }
    const prompt = draft.prompt.trim() || draft.use;
    if (!prompt) {
      onNotice("请输入音频描述或选择用途。");
      return;
    }
    setGenerating(true);
    setResult(undefined);
    try {
      const input: GenerateAudioInput = {
        projectId: project.id,
        kind,
        prompt: draft.use ? `${draft.use}：${draft.prompt}`.trim().replace(/：$/, "") : prompt,
        durationSeconds: draft.durationSeconds,
        loopable: kind === "ambience" ? draft.seamlessLoop : draft.loopable
      };
      if (kind === "bgm") {
        Object.assign(input, {
          style: draft.style || undefined,
          mood: draft.mood || undefined,
          bpm: draft.bpm || undefined,
          instrumental: draft.instrumental,
          hasLyrics: draft.hasLyrics
        });
      } else if (kind === "sfx") {
        Object.assign(input, { intensity: draft.intensity, dry: draft.dry });
      } else {
        Object.assign(input, { ambienceKeywords: draft.ambienceKeywords || undefined, seamlessLoop: draft.seamlessLoop });
      }
      const generated = await window.studio.generateAudio(input);
      setResult(generated);
      if (!generated.ok) onNotice(`生成失败：${generated.error}`);
    } catch (error) {
      onNotice(errText(error));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-4">
        <div className="flex gap-1">
          {KIND_TABS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setKind(entry.id)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                kind === entry.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {entry.icon}
              {entry.id.toUpperCase()}
            </button>
          ))}
        </div>

        <label className="text-xs font-medium">
          描述
          <textarea
            value={draft.prompt}
            onChange={(e) => update({ prompt: e.target.value })}
            rows={3}
            placeholder={
              kind === "bgm"
                ? "例如：紧张的 Boss 战循环音乐"
                : kind === "sfx"
                  ? "例如：复古激光射击音效"
                  : "例如：夜晚森林，虫鸣与微风"
            }
            className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
        </label>

        <label className="text-xs font-medium">
          用途
          <select value={draft.use} onChange={(e) => update({ use: e.target.value })} className={cn(selectClass, "mt-1 w-full")}>
            <option value="">不限</option>
            {uses.map((use) => (
              <option key={use} value={use}>
                {use}
              </option>
            ))}
          </select>
        </label>

        {kind === "bgm" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium">
                风格
                <select value={draft.style} onChange={(e) => update({ style: e.target.value })} className={cn(selectClass, "mt-1 w-full")}>
                  {BGM_STYLES.map((style) => (
                    <option key={style} value={style}>
                      {style || "默认"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium">
                情绪
                <select value={draft.mood} onChange={(e) => update({ mood: e.target.value })} className={cn(selectClass, "mt-1 w-full")}>
                  {BGM_MOODS.map((mood) => (
                    <option key={mood} value={mood}>
                      {mood || "默认"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium">
                时长（秒）
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={draft.durationSeconds}
                  onChange={(e) => update({ durationSeconds: Number(e.target.value) })}
                  className={cn(inputClass, "mt-1 w-full")}
                />
              </label>
              <label className="text-xs font-medium">
                BPM（0=不限）
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={draft.bpm}
                  onChange={(e) => update({ bpm: Number(e.target.value) })}
                  className={cn(inputClass, "mt-1 w-full")}
                />
              </label>
            </div>
            <div className="flex flex-col gap-1.5 text-xs">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={draft.loopable} onChange={(e) => update({ loopable: e.target.checked })} /> 循环（无缝衔接）
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.instrumental}
                  onChange={(e) => update({ instrumental: e.target.checked, hasLyrics: e.target.checked ? false : draft.hasLyrics })}
                />
                纯音乐（无人声）
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.hasLyrics}
                  onChange={(e) => update({ hasLyrics: e.target.checked, instrumental: e.target.checked ? false : draft.instrumental })}
                />
                有歌词
              </label>
            </div>
          </>
        )}

        {kind === "sfx" && (
          <>
            <label className="text-xs font-medium">
              时长（秒，0.5–5）
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.5}
                value={draft.durationSeconds > 5 ? 1 : draft.durationSeconds}
                onChange={(e) => update({ durationSeconds: Number(e.target.value) })}
                className={cn(inputClass, "mt-1 w-full")}
              />
            </label>
            <label className="text-xs font-medium">
              强度
              <select value={draft.intensity} onChange={(e) => update({ intensity: e.target.value as DraftState["intensity"] })} className={cn(selectClass, "mt-1 w-full")}>
                <option value="soft">轻</option>
                <option value="medium">中</option>
                <option value="strong">强</option>
              </select>
            </label>
            <div className="flex flex-col gap-1.5 text-xs">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={draft.dry} onChange={(e) => update({ dry: e.target.checked })} /> 干声（无混响）
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={draft.loopable} onChange={(e) => update({ loopable: e.target.checked })} /> 可循环
              </label>
            </div>
          </>
        )}

        {kind === "ambience" && (
          <>
            <label className="text-xs font-medium">
              氛围关键词
              <input
                value={draft.ambienceKeywords}
                onChange={(e) => update({ ambienceKeywords: e.target.value })}
                placeholder="如 birds, wind, distant thunder"
                className={cn(inputClass, "mt-1 w-full")}
              />
            </label>
            <label className="text-xs font-medium">
              时长（秒）
              <input
                type="number"
                min={5}
                max={180}
                value={draft.durationSeconds}
                onChange={(e) => update({ durationSeconds: Number(e.target.value) })}
                className={cn(inputClass, "mt-1 w-full")}
              />
            </label>
            <label className="inline-flex items-center gap-2 text-xs">
              <input type="checkbox" checked={draft.seamlessLoop} onChange={(e) => update({ seamlessLoop: e.target.checked })} /> 无缝循环
            </label>
          </>
        )}

        <Button onClick={() => void generate()} disabled={generating || !project}>
          {generating ? <Loader2 className="animate-spin" /> : <Music />} 生成音频
        </Button>
        {!hasProvider && (
          <p className="text-xs text-muted-foreground">还没有可用的音频服务商。先到「服务设置」添加 ACE Music 并填 API Key。</p>
        )}
        <p className="text-xs text-muted-foreground">音乐生成约 20–40 秒，请耐心等待。</p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
        {generating && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            正在生成音频…
          </div>
        )}
        {!generating && result?.ok && result.audios.length > 0 && (
          <div className="space-y-3">
            {result.audios.map((audio) => (
              <AudioCard key={audio.id} audio={audio} projectId={project!.id} onNotice={onNotice} />
            ))}
          </div>
        )}
        {!generating && result && !result.ok && (
          <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">生成失败：{result.error}</div>
        )}
        {!generating && !result && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Music className="size-8" />
            选择模式、填描述，生成的音频会保存进项目并出现在素材库。
          </div>
        )}
      </div>
    </div>
  );
}

/** 音频素材库区（素材库 Tab 内，图片素材下方）。 */
export function AudioLibrarySection({ project, onNotice }: { project?: StudioProject; onNotice: (text: string) => void }) {
  const [audios, setAudios] = useState<GeneratedAudioRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const lib = await window.studio.listGeneratedAudio(project.id);
      setAudios(lib.audios);
    } catch (error) {
      onNotice(errText(error));
    } finally {
      setLoading(false);
    }
  }, [project, onNotice]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium">音频素材 {audios.length}</h3>
        <Button variant="ghost" size="icon" title="刷新" onClick={() => void refresh()}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>
      {audios.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">还没有生成过音频。</p>
      ) : (
        <div className="space-y-2">
          {audios.map((audio) => (
            <AudioCard key={audio.id} audio={audio} projectId={project!.id} onNotice={onNotice} onChanged={refresh} withControls />
          ))}
        </div>
      )}
    </section>
  );
}

/** One audio clip: play/pause, loop, duration, copy res://, slot, delete. */
function AudioCard({
  audio,
  projectId,
  onNotice,
  onChanged,
  withControls
}: {
  audio: GeneratedAudioRecord;
  projectId: string;
  onNotice: (text: string) => void;
  onChanged?: () => void;
  withControls?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(Boolean(audio.loopable));
  const [duration, setDuration] = useState<number | undefined>(audio.durationSeconds);
  const [slotDraft, setSlotDraft] = useState(audio.slot ?? "");

  useEffect(() => {
    let cancelled = false;
    void window.studio
      .readProjectFile({ projectId, relativePath: audio.projectRelativePath })
      .then((preview) => {
        if (!cancelled && preview.dataUrl) setDataUrl(preview.dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, audio.projectRelativePath]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const commitSlot = async () => {
    if (slotDraft === (audio.slot ?? "")) return;
    try {
      await window.studio.setGeneratedAudioSlot({ projectId, audioId: audio.id, slot: slotDraft });
      onChanged?.();
    } catch (error) {
      onNotice(errText(error));
    }
  };

  const remove = async () => {
    if (!window.confirm(`删除音频 ${audio.fileName}？项目里的文件也会被删除。`)) return;
    try {
      await window.studio.deleteGeneratedAudio({ projectId, audioId: audio.id });
      onChanged?.();
    } catch (error) {
      onNotice(errText(error));
    }
  };

  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="size-9 shrink-0" onClick={toggle} disabled={!dataUrl} title={playing ? "暂停" : "播放"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-muted px-1.5 py-0.5">{AUDIO_KIND_LABELS[audio.kind]}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={audio.prompt}>
              {audio.prompt}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {duration ? `${duration.toFixed(1)}s` : "--"}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={slotDraft}
              onChange={(e) => setSlotDraft(e.target.value)}
              onBlur={() => void commitSlot()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="槽位（如 bgm.main）"
              list="audio-slot-suggestions"
              className={cn(inputClass, "h-7 flex-1")}
            />
            <datalist id="audio-slot-suggestions">
              {SLOT_SUGGESTIONS.map((slot) => (
                <option key={slot} value={slot} />
              ))}
            </datalist>
            <Button
              variant={loop ? "secondary" : "outline"}
              size="icon"
              className="size-7"
              title="循环试听"
              onClick={() => {
                setLoop((value) => !value);
                if (audioRef.current) audioRef.current.loop = !loop;
              }}
            >
              <Repeat />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              title={audio.resPath}
              onClick={() => {
                void navigator.clipboard.writeText(audio.resPath);
                onNotice(`已复制：${audio.resPath}`);
              }}
            >
              <Copy />
            </Button>
            {withControls && (
              <Button variant="ghost" size="icon" className="size-7" title="删除" onClick={() => void remove()}>
                <Trash2 />
              </Button>
            )}
          </div>
        </div>
      </div>
      {dataUrl && (
        <audio
          ref={audioRef}
          src={dataUrl}
          loop={loop}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            const d = (e.target as HTMLAudioElement).duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
          }}
          className="mt-2 h-7 w-full"
          controls
        />
      )}
    </div>
  );
}

interface AudioProviderDraft {
  id?: string;
  name: string;
  baseUrl: string;
  modelId: string;
  outputFormat: string;
  apiKey: string;
  order: number;
  enabled: boolean;
  hasApiKey: boolean;
}

const ACE_PRESET = {
  name: "ACE Music",
  baseUrl: "https://api.acemusic.ai/v1",
  modelId: "acemusic/acestep-v1.5-turbo",
  outputFormat: "mp3"
};

/** 音频服务商配置区（服务设置 Tab 内，图片服务商下方）。 */
export function AudioSettingsSection({ onNotice }: { onNotice: (text: string) => void }) {
  const [settings, setSettings] = useState<AudioGenerationSettings>();
  const [drafts, setDrafts] = useState<AudioProviderDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<Record<string, MediaProviderTestResult | "testing">>({});

  const apply = useCallback((next: AudioGenerationSettings) => {
    setSettings(next);
    setDrafts(
      next.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        modelId: provider.modelId,
        outputFormat: provider.outputFormat,
        apiKey: "",
        order: provider.order,
        enabled: provider.enabled,
        hasApiKey: provider.hasApiKey
      }))
    );
  }, []);

  useEffect(() => {
    void window.studio
      .getAudioSettings()
      .then(apply)
      .catch((error) => onNotice(errText(error)));
  }, [apply, onNotice]);

  const updateDraft = (index: number, patch: Partial<AudioProviderDraft>) =>
    setDrafts((cur) => cur.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  const save = async (draft: AudioProviderDraft) => {
    setBusy(true);
    try {
      apply(
        await window.studio.saveAudioProvider({
          id: draft.id,
          name: draft.name,
          protocol: "ace-music-v1",
          baseUrl: draft.baseUrl,
          modelId: draft.modelId,
          outputFormat: draft.outputFormat,
          order: draft.order,
          enabled: draft.enabled,
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {})
        })
      );
      onNotice(`音频服务商「${draft.name}」已保存。`);
    } catch (error) {
      onNotice(errText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (draft: AudioProviderDraft) => {
    if (!draft.id) {
      setDrafts((cur) => cur.filter((d) => d !== draft));
      return;
    }
    if (!window.confirm(`删除音频服务商「${draft.name}」？`)) return;
    setBusy(true);
    try {
      apply(await window.studio.deleteAudioProvider(draft.id));
    } catch (error) {
      onNotice(errText(error));
    } finally {
      setBusy(false);
    }
  };

  const test = async (draft: AudioProviderDraft) => {
    if (!draft.id) {
      onNotice("请先保存服务商，再测试连接。");
      return;
    }
    setTests((cur) => ({ ...cur, [draft.id!]: "testing" }));
    try {
      const result = await window.studio.testAudioProvider(draft.id);
      setTests((cur) => ({ ...cur, [draft.id!]: result }));
    } catch (error) {
      onNotice(errText(error));
    }
  };

  const clearKey = async (draft: AudioProviderDraft) => {
    if (!draft.id) return;
    setBusy(true);
    try {
      apply(
        await window.studio.saveAudioProvider({
          id: draft.id,
          name: draft.name,
          protocol: "ace-music-v1",
          baseUrl: draft.baseUrl,
          modelId: draft.modelId,
          outputFormat: draft.outputFormat,
          order: draft.order,
          enabled: draft.enabled,
          apiKey: ""
        })
      );
    } catch (error) {
      onNotice(errText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium">音频服务商</h3>
        <span className="text-xs text-muted-foreground">ACE Music 等文生音频服务，Key 只存本机。</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDrafts((cur) => [
                ...cur,
                { ...ACE_PRESET, apiKey: "", order: cur.length, enabled: true, hasApiKey: false }
              ])
            }
          >
            <Plus /> ACE Music
          </Button>
        </div>
      </div>

      {settings && (
        <label className="mb-2 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
          <input
            type="checkbox"
            checked={settings.autoGenerateInWorkflow}
            onChange={async (e) => {
              try {
                setSettings(await window.studio.setAudioAutoGenerate(e.target.checked));
              } catch (error) {
                onNotice(errText(error));
              }
            }}
          />
          创建游戏的团队工作流中自动生成音频（1 首 BGM + 核心音效）
        </label>
      )}

      <div className="space-y-2">
        {drafts.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            还没有音频服务商。点右上角「ACE Music」快速添加，填入 API Key 后即可生成。
          </p>
        )}
        {drafts.map((draft, index) => (
          <div key={draft.id ?? `new-${index}`} className="flex flex-col gap-2 rounded-md border border-border p-2">
            <div className="grid grid-cols-[10rem_1fr_8rem_12rem_auto] items-start gap-2">
              <div className="space-y-1.5">
                <input value={draft.name} onChange={(e) => updateDraft(index, { name: e.target.value })} placeholder="名称" className={cn(inputClass, "w-full")} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={draft.enabled} onChange={(e) => updateDraft(index, { enabled: e.target.checked })} /> 启用
                </label>
              </div>
              <div className="space-y-1.5">
                <input value={draft.baseUrl} onChange={(e) => updateDraft(index, { baseUrl: e.target.value })} placeholder="API 基址" className={cn(inputClass, "w-full")} />
                <input value={draft.modelId} onChange={(e) => updateDraft(index, { modelId: e.target.value })} placeholder="上游模型 ID" className={cn(inputClass, "w-full font-mono")} />
              </div>
              <select value={draft.outputFormat} onChange={(e) => updateDraft(index, { outputFormat: e.target.value })} className={cn(selectClass, "w-full")}>
                <option value="mp3">mp3</option>
                <option value="wav">wav</option>
                <option value="ogg">ogg</option>
              </select>
              <input
                type="password"
                value={draft.apiKey}
                onChange={(e) => updateDraft(index, { apiKey: e.target.value })}
                placeholder={draft.hasApiKey ? "已配置，留空不改" : "API Key"}
                className={cn(inputClass, "w-full")}
              />
              <div className="flex items-center gap-1">
                <Button size="sm" disabled={busy} onClick={() => void save(draft)}>
                  保存
                </Button>
                {draft.id && (
                  <Button size="sm" variant="outline" disabled={tests[draft.id] === "testing"} title="只读探测，不消耗额度" onClick={() => void test(draft)}>
                    {tests[draft.id] === "testing" ? <Loader2 className="animate-spin" /> : "测试"}
                  </Button>
                )}
                {draft.hasApiKey && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void clearKey(draft)}>
                    清 Key
                  </Button>
                )}
                <Button size="sm" variant={draft.id ? "destructive" : "ghost"} disabled={busy} onClick={() => void remove(draft)}>
                  {draft.id ? "删除" : "取消"}
                </Button>
              </div>
            </div>
            {draft.id && tests[draft.id] && tests[draft.id] !== "testing" && (
              <AudioTestLine result={tests[draft.id] as MediaProviderTestResult} />
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        协议 ace-music-v1：同步返回 mp3，Godot 4 原生支持。输出格式 wav/ogg 转码后续支持，目前实际保存为上游返回格式。
      </p>
    </section>
  );
}

function AudioTestLine({ result }: { result: MediaProviderTestResult }) {
  return (
    <div
      className={cn(
        "rounded-md px-2.5 py-1.5 text-xs",
        result.ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-danger/10 text-danger"
      )}
    >
      {result.ok ? "✓ " : "✗ "}
      {result.message}
      {result.httpStatus ? `（HTTP ${result.httpStatus}）` : ""}
      <span className="ml-1 opacity-60">· {Math.round(result.durationMs / 100) / 10}s</span>
    </div>
  );
}
