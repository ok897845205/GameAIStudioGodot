import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Copy,
  Image as ImageIcon,
  Library,
  Loader2,
  Music,
  Palette,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2
} from "lucide-react";
import { AudioGeneratePanel, AudioLibrarySection, AudioSettingsSection } from "./audio-workshop";
import type {
  GeneratedAssetAspect,
  GeneratedAssetPurpose,
  GeneratedAssetRecord,
  GenerateImageResult,
  MediaGenerationSettings,
  MediaProtocolId,
  MediaProviderTestResult,
  StudioProject
} from "@gameaistudio/shared";
import { GENERATED_ASSET_PURPOSE_LABELS } from "@gameaistudio/shared";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

type WorkshopTab = "generate" | "audio" | "library" | "settings";

// 服务设置已内置（金山云/OpenRouter/ACE，密钥加密内置），暂时隐藏配置入口。
// 需要恢复用户自配时，把这个改回 true 即可（无需删代码）。
const SHOW_SERVICE_SETTINGS = false;

const PURPOSE_OPTIONS = Object.entries(GENERATED_ASSET_PURPOSE_LABELS) as Array<[GeneratedAssetPurpose, string]>;

const STYLE_PRESETS: Array<{ label: string; value?: string }> = [
  { label: "默认" },
  { label: "像素风", value: "pixel art, retro game style" },
  { label: "卡通", value: "cartoon style, vibrant colors" },
  { label: "写实", value: "realistic, highly detailed" },
  { label: "低多边形", value: "low poly 3D render style" },
  { label: "赛博朋克", value: "cyberpunk style, neon lights" },
  { label: "国风", value: "traditional Chinese art style, ink painting" },
  { label: "儿童向", value: "cute kawaii style, soft colors, children friendly" },
  { label: "暗黑", value: "dark fantasy style, moody atmosphere" }
];

const ASPECT_OPTIONS: Array<{ label: string; value?: GeneratedAssetAspect }> = [
  { label: "默认" },
  { label: "1:1", value: "1:1" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" }
];

const PROTOCOL_OPTIONS: Array<{ id: MediaProtocolId; label: string }> = [
  { id: "openai-images-v1", label: "OpenAI images/generations" },
  { id: "openai-chat-image-v1", label: "OpenAI chat 图像输出（OpenRouter 等）" },
  { id: "gemini-image-v1", label: "Gemini generateContent 图像" }
];

const PROVIDER_PRESETS: Array<{ name: string; protocol: MediaProtocolId; baseUrl: string }> = [
  { name: "OpenAI", protocol: "openai-images-v1", baseUrl: "https://api.openai.com/v1" },
  { name: "OpenRouter", protocol: "openai-chat-image-v1", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "Google Gemini", protocol: "gemini-image-v1", baseUrl: "https://generativelanguage.googleapis.com/v1beta" }
];

const MODEL_PRESETS: Array<{ id: string; displayName: string }> = [
  { id: "nano-banana", displayName: "Nano Banana" },
  { id: "nano-banana-2", displayName: "Nano Banana 2" },
  { id: "nano-banana-pro", displayName: "Nano Banana Pro" },
  { id: "gpt-image-2", displayName: "GPT Image 2" }
];

const SLOT_SUGGESTIONS = ["player.main", "enemy.basic", "item.coin", "world.background", "ui.button", "ui.icon", "cover.main"];

interface ProviderDraft {
  id?: string;
  name: string;
  protocol: MediaProtocolId;
  baseUrl: string;
  apiKey: string;
  headersJson: string;
  enabled: boolean;
  hasApiKey: boolean;
}

interface BindingDraft {
  id?: string;
  providerId: string;
  upstreamModelId: string;
  order: number;
  enabled: boolean;
}

interface ModelDraft {
  id: string;
  displayName: string;
  order: number;
  enabled: boolean;
  bindings: BindingDraft[];
}

function errText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

const inputClass = "h-8 rounded-md border border-border bg-background px-2 text-xs";
const selectClass = "h-8 rounded-md border border-border bg-background px-1.5 text-xs";

/**
 * AI 素材工坊 — generate game art with the user's own model providers, manage
 * the generated asset library (slots, res:// paths), configure providers and
 * model routing.
 *
 * Stays mounted once opened (visibility toggle) so in-flight generations
 * survive switching back to chat.
 */
export function AssetWorkshopView({
  active,
  project,
  onClose
}: {
  active: boolean;
  project?: StudioProject;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<WorkshopTab>("library");
  const [notice, setNotice] = useState("");

  // ── generate tab ──────────────────────────────────────────────────────
  const [prompt, setPrompt] = useState("");
  const [purpose, setPurpose] = useState<GeneratedAssetPurpose>("character");
  const [styleIndex, setStyleIndex] = useState(0);
  const [aspectIndex, setAspectIndex] = useState(0);
  const [transparent, setTransparent] = useState(false);
  const [modelId, setModelId] = useState("");
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<GenerateImageResult>();

  // ── library tab ───────────────────────────────────────────────────────
  const [assets, setAssets] = useState<GeneratedAssetRecord[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [slotDrafts, setSlotDrafts] = useState<Record<string, string>>({});
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string>();

  // ── settings tab ──────────────────────────────────────────────────────
  const [settings, setSettings] = useState<MediaGenerationSettings>();
  const [providerDrafts, setProviderDrafts] = useState<ProviderDraft[]>([]);
  const [modelDrafts, setModelDrafts] = useState<ModelDraft[]>([]);
  const [newModelId, setNewModelId] = useState(MODEL_PRESETS[0]!.id);
  const [customModelId, setCustomModelId] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [providerTests, setProviderTests] = useState<Record<string, MediaProviderTestResult | "testing">>({});

  const applySettings = useCallback((next: MediaGenerationSettings) => {
    setSettings(next);
    setProviderDrafts(
      next.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        apiKey: "",
        headersJson: provider.extraHeaders ? JSON.stringify(provider.extraHeaders) : "",
        enabled: provider.enabled,
        hasApiKey: provider.hasApiKey
      }))
    );
    setModelDrafts(
      next.models
        .filter((model) => model.kind === "image")
        .map((model) => ({
          id: model.id,
          displayName: model.displayName,
          order: model.order,
          enabled: model.enabled,
          bindings: model.bindings.map((binding) => ({ ...binding }))
        }))
    );
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      applySettings(await window.studio.getMediaSettings());
    } catch (error) {
      setNotice(errText(error));
    }
  }, [applySettings]);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const loadThumb = useCallback(
    async (asset: GeneratedAssetRecord) => {
      if (!project) return;
      try {
        const preview = await window.studio.readProjectFile({
          projectId: project.id,
          relativePath: asset.projectRelativePath
        });
        if (preview.dataUrl) {
          setThumbs((current) => ({ ...current, [asset.id]: preview.dataUrl! }));
        }
      } catch {
        // 文件可能已被外部删除 — 缩略图留空即可
      }
    },
    [project]
  );

  const refreshLibrary = useCallback(async () => {
    if (!project) return;
    setLibraryLoading(true);
    try {
      const library = await window.studio.listGeneratedAssets(project.id);
      setAssets(library.assets);
      setSlotDrafts(Object.fromEntries(library.assets.map((asset) => [asset.id, asset.slot ?? ""])));
      for (const asset of library.assets) {
        if (!thumbs[asset.id]) void loadThumb(asset);
      }
    } catch (error) {
      setNotice(errText(error));
    } finally {
      setLibraryLoading(false);
    }
  }, [project, thumbs, loadThumb]);

  // The workshop is mounted once and visibility-toggled, so switching the
  // selected project must clear the previous project's generated results and
  // thumbnails — the workshop belongs to whichever project is selected.
  const projectId = project?.id;
  useEffect(() => {
    setLastResult(undefined);
    setThumbs({});
    setSlotDrafts({});
  }, [projectId]);

  // Reload the library when the workshop becomes visible for a project.
  useEffect(() => {
    if (active && projectId) {
      void refreshLibrary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectId]);

  const imageModels = (settings?.models ?? []).filter((model) => model.kind === "image" && model.enabled);

  const generate = async () => {
    if (!project) {
      setNotice("请先选择一个项目，生成的素材会保存进项目目录。");
      return;
    }
    if (!prompt.trim()) {
      setNotice("请输入素材描述。");
      return;
    }
    setGenerating(true);
    setNotice("");
    setLastResult(undefined);
    try {
      const result = await window.studio.generateImage({
        projectId: project.id,
        prompt: prompt.trim(),
        purpose,
        style: STYLE_PRESETS[styleIndex]?.value,
        aspectRatio: ASPECT_OPTIONS[aspectIndex]?.value,
        transparentBackground: transparent,
        modelId: modelId || undefined,
        count
      });
      setLastResult(result);
      if (result.ok) {
        for (const asset of result.assets) void loadThumb(asset);
        await refreshLibrary();
      }
    } catch (error) {
      setNotice(errText(error));
    } finally {
      setGenerating(false);
    }
  };

  const copyResPath = async (asset: GeneratedAssetRecord) => {
    await navigator.clipboard.writeText(asset.resPath);
    setNotice(`已复制：${asset.resPath}`);
  };

  const deleteAsset = async (asset: GeneratedAssetRecord) => {
    if (!project) return;
    if (!window.confirm(`删除素材 ${asset.fileName}？项目里的文件也会被删除。`)) return;
    try {
      const library = await window.studio.deleteGeneratedAsset({ projectId: project.id, assetId: asset.id });
      setAssets(library.assets);
    } catch (error) {
      setNotice(errText(error));
    }
  };

  const commitSlot = async (asset: GeneratedAssetRecord) => {
    if (!project) return;
    const slot = slotDrafts[asset.id] ?? "";
    if (slot === (asset.slot ?? "")) return;
    try {
      const library = await window.studio.setGeneratedAssetSlot({ projectId: project.id, assetId: asset.id, slot });
      setAssets(library.assets);
      setSlotDrafts(Object.fromEntries(library.assets.map((entry) => [entry.id, entry.slot ?? ""])));
    } catch (error) {
      setNotice(errText(error));
    }
  };

  const regenerateAsset = async (asset: GeneratedAssetRecord) => {
    if (!project) return;
    setRegeneratingId(asset.id);
    try {
      const result = await window.studio.regenerateImage({ projectId: project.id, assetId: asset.id });
      if (!result.ok) {
        setNotice(`重新生成失败：${result.error}`);
        return;
      }
      // Same res:// path & slot; just refresh the thumbnail and library.
      setThumbs((current) => {
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
      for (const updated of result.assets) void loadThumb(updated);
      await refreshLibrary();
      setNotice(`已重新生成「${asset.prompt.slice(0, 16)}」，路径和槽位不变。`);
    } catch (error) {
      setNotice(errText(error));
    } finally {
      setRegeneratingId(undefined);
    }
  };

  const saveProvider = async (draft: ProviderDraft) => {
    setSettingsBusy(true);
    try {
      let extraHeaders: Record<string, string> | undefined;
      if (draft.headersJson.trim()) {
        try {
          extraHeaders = JSON.parse(draft.headersJson) as Record<string, string>;
        } catch {
          throw new Error("额外请求头不是合法 JSON。");
        }
      }
      applySettings(
        await window.studio.saveMediaProvider({
          id: draft.id,
          name: draft.name,
          protocol: draft.protocol,
          baseUrl: draft.baseUrl,
          extraHeaders,
          enabled: draft.enabled,
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {})
        })
      );
      setNotice(`服务商「${draft.name}」已保存。`);
    } catch (error) {
      setNotice(errText(error));
    } finally {
      setSettingsBusy(false);
    }
  };

  const clearProviderKey = async (draft: ProviderDraft) => {
    if (!draft.id) return;
    setSettingsBusy(true);
    try {
      applySettings(
        await window.studio.saveMediaProvider({
          id: draft.id,
          name: draft.name,
          protocol: draft.protocol,
          baseUrl: draft.baseUrl,
          enabled: draft.enabled,
          apiKey: ""
        })
      );
      setNotice(`已清除「${draft.name}」的 API Key。`);
    } catch (error) {
      setNotice(errText(error));
    } finally {
      setSettingsBusy(false);
    }
  };

  const deleteProvider = async (draft: ProviderDraft) => {
    if (!draft.id) return;
    if (!window.confirm(`删除服务商「${draft.name}」？引用它的模型绑定会一并移除。`)) return;
    setSettingsBusy(true);
    try {
      applySettings(await window.studio.deleteMediaProvider(draft.id));
    } catch (error) {
      setNotice(errText(error));
    } finally {
      setSettingsBusy(false);
    }
  };

  const testProvider = async (draft: ProviderDraft) => {
    if (!draft.id) {
      setNotice("请先保存服务商，再测试连接。");
      return;
    }
    setProviderTests((current) => ({ ...current, [draft.id!]: "testing" }));
    try {
      const result = await window.studio.testMediaProvider(draft.id);
      setProviderTests((current) => ({ ...current, [draft.id!]: result }));
    } catch (error) {
      setNotice(errText(error));
      setProviderTests((current) => {
        const next = { ...current };
        delete next[draft.id!];
        return next;
      });
    }
  };

  const addProvider = (preset?: (typeof PROVIDER_PRESETS)[number]) => {
    setProviderDrafts((current) => [
      ...current,
      {
        name: preset?.name ?? "",
        protocol: preset?.protocol ?? "openai-images-v1",
        baseUrl: preset?.baseUrl ?? "",
        apiKey: "",
        headersJson: "",
        enabled: true,
        hasApiKey: false
      }
    ]);
  };

  const updateProviderDraft = (index: number, patch: Partial<ProviderDraft>) => {
    setProviderDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  const saveModel = async (draft: ModelDraft) => {
    setSettingsBusy(true);
    try {
      applySettings(
        await window.studio.saveMediaModel({
          id: draft.id,
          kind: "image",
          displayName: draft.displayName,
          order: draft.order,
          enabled: draft.enabled,
          bindings: draft.bindings
        })
      );
      setNotice(`模型「${draft.displayName}」已保存。`);
    } catch (error) {
      setNotice(errText(error));
    } finally {
      setSettingsBusy(false);
    }
  };

  const deleteModel = async (draft: ModelDraft) => {
    if (!window.confirm(`删除模型「${draft.displayName}」？`)) return;
    setSettingsBusy(true);
    try {
      applySettings(await window.studio.deleteMediaModel(draft.id));
    } catch (error) {
      setNotice(errText(error));
    } finally {
      setSettingsBusy(false);
    }
  };

  const addModelDraft = () => {
    const id = newModelId === "__custom__" ? customModelId.trim() : newModelId;
    if (!id) {
      setNotice("请输入模型 ID。");
      return;
    }
    if (modelDrafts.some((draft) => draft.id === id)) {
      setNotice(`模型 ${id} 已存在。`);
      return;
    }
    const preset = MODEL_PRESETS.find((entry) => entry.id === id);
    setModelDrafts((current) => [
      ...current,
      { id, displayName: preset?.displayName ?? id, order: current.length, enabled: true, bindings: [] }
    ]);
  };

  const updateModelDraft = (index: number, patch: Partial<ModelDraft>) => {
    setModelDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  const tabButton = (id: WorkshopTab, icon: ReactNode, label: string) => (
    <button
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      // Inline colors so the segmented control reads clearly as buttons
      // regardless of how Tailwind compiles arbitrary tokens.
      style={tab === id ? { backgroundColor: "#ffffff", color: "#2f6fdb" } : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors",
        tab === id ? "shadow-sm ring-1 ring-black/10" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      className={cn(
        "absolute inset-0 z-30 flex flex-col bg-background",
        active ? "visible" : "invisible pointer-events-none"
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="outline" size="sm" onClick={onClose} title="返回工作台">
          <ArrowLeft /> 返回
        </Button>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Palette className="size-4" /> AI 素材工坊
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {project ? `当前项目：${project.name}` : "未选择项目 — 生成功能需要先选择项目"}
        </span>
        {/* Segmented control: grey track makes each tab read as a button. */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-1">
          {tabButton("generate", <ImageIcon className="size-3.5" />, "图片")}
          {tabButton("audio", <Music className="size-3.5" />, "音频")}
          {SHOW_SERVICE_SETTINGS && tabButton("settings", <Settings2 className="size-3.5" />, "服务设置")}
          {tabButton("library", <Library className="size-3.5" />, "素材库")}
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 break-words">{notice}</span>
          <button className="shrink-0 font-medium hover:underline" onClick={() => setNotice("")}>
            关闭
          </button>
        </div>
      )}

      {/* ── 生成 ── */}
      {tab === "generate" && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-4">
            <label className="text-xs font-medium">
              素材描述
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="例如：一只穿盔甲的橘猫骑士，侧面站姿"
                className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-medium">
              用途
              <select value={purpose} onChange={(e) => setPurpose(e.target.value as GeneratedAssetPurpose)} className={cn(selectClass, "mt-1 w-full")}>
                {PURPOSE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium">
                风格
                <select value={styleIndex} onChange={(e) => setStyleIndex(Number(e.target.value))} className={cn(selectClass, "mt-1 w-full")}>
                  {STYLE_PRESETS.map((style, index) => (
                    <option key={style.label} value={index}>
                      {style.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium">
                比例
                <select value={aspectIndex} onChange={(e) => setAspectIndex(Number(e.target.value))} className={cn(selectClass, "mt-1 w-full")}>
                  {ASPECT_OPTIONS.map((aspect, index) => (
                    <option key={aspect.label} value={index}>
                      {aspect.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium">
                模型
                <select value={modelId} onChange={(e) => setModelId(e.target.value)} className={cn(selectClass, "mt-1 w-full")}>
                  <option value="">自动（按顺序）</option>
                  {imageModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium">
                张数
                <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={cn(selectClass, "mt-1 w-full")}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-xs">
              <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
              透明背景（gpt-image 协议支持真透明，其余模型按纯色底处理）
            </label>
            <Button onClick={() => void generate()} disabled={generating || !project}>
              {generating ? <Loader2 className="animate-spin" /> : <Sparkles />} 生成素材
            </Button>
            {imageModels.length === 0 && (
              <p className="text-xs text-muted-foreground">
                还没有配置图片模型。先到「服务设置」添加服务商和模型绑定。
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
            {generating && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
                正在生成素材，通常需要 10–60 秒…
              </div>
            )}
            {!generating && lastResult && (
              <div className="space-y-3">
                {!lastResult.ok && (
                  <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
                    生成失败：{lastResult.error}
                  </div>
                )}
                {lastResult.attempts.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">调用明细（{lastResult.attempts.length} 次尝试）</summary>
                    <ul className="mt-1 space-y-0.5">
                      {lastResult.attempts.map((attempt, index) => (
                        <li key={index}>
                          {attempt.ok ? "✓" : "✗"} {attempt.providerName} / {attempt.upstreamModelId}（{Math.round(attempt.durationMs / 100) / 10}s）
                          {attempt.error ? ` — ${attempt.error}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {lastResult.assets.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                    {lastResult.assets.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        thumb={thumbs[asset.id]}
                        slotDraft={slotDrafts[asset.id] ?? asset.slot ?? ""}
                        onSlotDraft={(value) => setSlotDrafts((current) => ({ ...current, [asset.id]: value }))}
                        onSlotCommit={() => void commitSlot(asset)}
                        onCopy={() => void copyResPath(asset)}
                        onDelete={() => void deleteAsset(asset)}
                        onRegenerate={() => void regenerateAsset(asset)}
                        regenerating={regeneratingId === asset.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            {!generating && !lastResult && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <ImageIcon className="size-8" />
                描述你要的素材，生成结果会自动保存进项目并出现在素材库。
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 音频 ── */}
      {tab === "audio" && <AudioGeneratePanel project={project} onNotice={setNotice} />}

      {/* ── 素材库 ── */}
      {tab === "library" && (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-medium">图片素材 {assets.length}</span>
              <Button variant="ghost" size="icon" title="刷新" onClick={() => void refreshLibrary()}>
                {libraryLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              </Button>
              <span className="text-xs text-muted-foreground">
                槽位（如 player.main）让 Agent 知道每张图的游戏角色；res:// 路径可直接用于场景。
              </span>
            </div>
            {assets.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                {project ? "还没有生成过图片素材。" : "请先选择一个项目。"}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {assets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    thumb={thumbs[asset.id]}
                    slotDraft={slotDrafts[asset.id] ?? ""}
                    onSlotDraft={(value) => setSlotDrafts((current) => ({ ...current, [asset.id]: value }))}
                    onSlotCommit={() => void commitSlot(asset)}
                    onCopy={() => void copyResPath(asset)}
                    onDelete={() => void deleteAsset(asset)}
                    onRegenerate={() => void regenerateAsset(asset)}
                    regenerating={regeneratingId === asset.id}
                  />
                ))}
              </div>
            )}
          </section>
          <AudioLibrarySection project={project} onNotice={setNotice} />
        </div>
      )}

      {/* ── 服务设置 ── */}
      {SHOW_SERVICE_SETTINGS && tab === "settings" && (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-medium">API 服务商</h3>
              <span className="text-xs text-muted-foreground">填你自己的厂商地址和 Key，Key 只保存在本机；服务设置为全局，所有项目共用，生成的素材保存进当前项目。</span>
              <div className="ml-auto flex items-center gap-1">
                {PROVIDER_PRESETS.map((preset) => (
                  <Button key={preset.name} variant="outline" size="sm" onClick={() => addProvider(preset)}>
                    <Plus /> {preset.name}
                  </Button>
                ))}
                <Button variant="outline" size="sm" onClick={() => addProvider()}>
                  <Plus /> 自定义
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {providerDrafts.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  还没有服务商。点右上角按预设快速添加。
                </p>
              )}
              {providerDrafts.map((draft, index) => (
                <div key={draft.id ?? `new-${index}`} className="flex flex-col gap-2 rounded-md border border-border p-2">
                  <div className="grid grid-cols-[10rem_14rem_1fr_12rem_auto] items-start gap-2">
                  <div className="space-y-1.5">
                    <input
                      value={draft.name}
                      onChange={(e) => updateProviderDraft(index, { name: e.target.value })}
                      placeholder="名称（如 OpenAI）"
                      className={cn(inputClass, "w-full")}
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={draft.enabled} onChange={(e) => updateProviderDraft(index, { enabled: e.target.checked })} />
                      启用
                    </label>
                  </div>
                  <select
                    value={draft.protocol}
                    onChange={(e) => updateProviderDraft(index, { protocol: e.target.value as MediaProtocolId })}
                    className={cn(selectClass, "w-full")}
                  >
                    {PROTOCOL_OPTIONS.map((protocol) => (
                      <option key={protocol.id} value={protocol.id}>
                        {protocol.label}
                      </option>
                    ))}
                  </select>
                  <div className="space-y-1.5">
                    <input
                      value={draft.baseUrl}
                      onChange={(e) => updateProviderDraft(index, { baseUrl: e.target.value })}
                      placeholder="API 基址（https://…/v1）"
                      className={cn(inputClass, "w-full")}
                    />
                    <input
                      value={draft.headersJson}
                      onChange={(e) => updateProviderDraft(index, { headersJson: e.target.value })}
                      placeholder='额外请求头 JSON（可选，如 {"X-Foo":"bar"}）'
                      className={cn(inputClass, "w-full font-mono")}
                    />
                  </div>
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(e) => updateProviderDraft(index, { apiKey: e.target.value })}
                    placeholder={draft.hasApiKey ? "已配置，留空不改" : "API Key"}
                    className={cn(inputClass, "w-full")}
                  />
                  <div className="flex items-center gap-1">
                    <Button size="sm" disabled={settingsBusy} onClick={() => void saveProvider(draft)}>
                      保存
                    </Button>
                    {draft.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={providerTests[draft.id] === "testing"}
                        title="只读探测基址+Key，不消耗生图额度"
                        onClick={() => void testProvider(draft)}
                      >
                        {providerTests[draft.id] === "testing" ? <Loader2 className="animate-spin" /> : "测试"}
                      </Button>
                    )}
                    {draft.hasApiKey && (
                      <Button size="sm" variant="outline" disabled={settingsBusy} onClick={() => void clearProviderKey(draft)}>
                        清 Key
                      </Button>
                    )}
                    {draft.id ? (
                      <Button size="sm" variant="destructive" disabled={settingsBusy} onClick={() => void deleteProvider(draft)}>
                        删除
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setProviderDrafts((current) => current.filter((_, i) => i !== index))}>
                        取消
                      </Button>
                    )}
                  </div>
                  </div>
                  {draft.id && providerTests[draft.id] && providerTests[draft.id] !== "testing" && (
                    <ProviderTestLine result={providerTests[draft.id] as MediaProviderTestResult} />
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-medium">图片模型与路由</h3>
              <span className="text-xs text-muted-foreground">每个模型可绑定多个服务商，调用顺序小的先试，失败自动降级。</span>
              <div className="ml-auto flex items-center gap-1">
                <select value={newModelId} onChange={(e) => setNewModelId(e.target.value)} className={selectClass}>
                  {MODEL_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.displayName}（{preset.id}）
                    </option>
                  ))}
                  <option value="__custom__">自定义模型 ID…</option>
                </select>
                {newModelId === "__custom__" && (
                  <input
                    value={customModelId}
                    onChange={(e) => setCustomModelId(e.target.value)}
                    placeholder="模型 ID"
                    className={cn(inputClass, "w-32")}
                  />
                )}
                <Button variant="outline" size="sm" onClick={addModelDraft}>
                  <Plus /> 添加模型
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {modelDrafts.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  还没有模型。先添加服务商，再添加模型并绑定。
                </p>
              )}
              {modelDrafts.map((model, modelIndex) => (
                <div key={model.id} className="rounded-md border border-border p-2">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{model.id}</code>
                    <input
                      value={model.displayName}
                      onChange={(e) => updateModelDraft(modelIndex, { displayName: e.target.value })}
                      className={cn(inputClass, "w-40")}
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={model.enabled}
                        onChange={(e) => updateModelDraft(modelIndex, { enabled: e.target.checked })}
                      />
                      启用
                    </label>
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateModelDraft(modelIndex, {
                            bindings: [
                              ...model.bindings,
                              {
                                providerId: providerDrafts.find((p) => p.id)?.id ?? "",
                                upstreamModelId: "",
                                order: model.bindings.length + 1,
                                enabled: true
                              }
                            ]
                          })
                        }
                      >
                        <Plus /> 绑定
                      </Button>
                      <Button size="sm" disabled={settingsBusy} onClick={() => void saveModel(model)}>
                        保存
                      </Button>
                      <Button size="sm" variant="destructive" disabled={settingsBusy} onClick={() => void deleteModel(model)}>
                        删除
                      </Button>
                    </div>
                  </div>
                  {model.bindings.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {model.bindings.map((binding, bindingIndex) => (
                        <div key={binding.id ?? `b-${bindingIndex}`} className="flex items-center gap-2 pl-4">
                          <select
                            value={binding.providerId}
                            onChange={(e) =>
                              updateModelDraft(modelIndex, {
                                bindings: model.bindings.map((b, i) => (i === bindingIndex ? { ...b, providerId: e.target.value } : b))
                              })
                            }
                            className={cn(selectClass, "w-44")}
                          >
                            <option value="">选择服务商…</option>
                            {(settings?.providers ?? []).map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </select>
                          <input
                            value={binding.upstreamModelId}
                            onChange={(e) =>
                              updateModelDraft(modelIndex, {
                                bindings: model.bindings.map((b, i) => (i === bindingIndex ? { ...b, upstreamModelId: e.target.value } : b))
                              })
                            }
                            placeholder="上游 model id（如 gpt-image-1）"
                            className={cn(inputClass, "w-64")}
                          />
                          <input
                            type="number"
                            value={binding.order}
                            onChange={(e) =>
                              updateModelDraft(modelIndex, {
                                bindings: model.bindings.map((b, i) => (i === bindingIndex ? { ...b, order: Number(e.target.value) } : b))
                              })
                            }
                            title="调用顺序，小的先试"
                            className={cn(inputClass, "w-16")}
                          />
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={binding.enabled}
                              onChange={(e) =>
                                updateModelDraft(modelIndex, {
                                  bindings: model.bindings.map((b, i) => (i === bindingIndex ? { ...b, enabled: e.target.checked } : b))
                                })
                              }
                            />
                            启用
                          </label>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              updateModelDraft(modelIndex, { bindings: model.bindings.filter((_, i) => i !== bindingIndex) })
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <AudioSettingsSection onNotice={setNotice} />
        </div>
      )}

    </div>
  );
}

function ProviderTestLine({ result }: { result: MediaProviderTestResult }) {
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

function AssetCard({
  asset,
  thumb,
  slotDraft,
  onSlotDraft,
  onSlotCommit,
  onCopy,
  onDelete,
  onRegenerate,
  regenerating
}: {
  asset: GeneratedAssetRecord;
  thumb?: string;
  slotDraft: string;
  onSlotDraft: (value: string) => void;
  onSlotCommit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border">
      <div className="flex aspect-square items-center justify-center bg-muted/40">
        {thumb ? (
          // Checkerboard-free simple preview; object-contain keeps full image visible.
          <img src={thumb} alt={asset.fileName} className="max-h-full max-w-full object-contain" />
        ) : (
          <ImageIcon className="size-8 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-1.5 p-2">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="rounded bg-muted px-1.5 py-0.5">{GENERATED_ASSET_PURPOSE_LABELS[asset.purpose]}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={asset.prompt}>
            {asset.prompt}
          </span>
        </div>
        <input
          value={slotDraft}
          onChange={(e) => onSlotDraft(e.target.value)}
          onBlur={onSlotCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder={`槽位（如 ${SLOT_SUGGESTIONS[0]}）`}
          list="asset-slot-suggestions"
          className={cn(inputClass, "h-7 w-full")}
        />
        <datalist id="asset-slot-suggestions">
          {SLOT_SUGGESTIONS.map((slot) => (
            <option key={slot} value={slot} />
          ))}
        </datalist>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 flex-1" title={asset.resPath} onClick={onCopy}>
            <Copy /> res:// 路径
          </Button>
          {onRegenerate && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              title="重新生成（替换原图，保持 res:// 路径和槽位不变，已接入的代码不受影响）"
              disabled={regenerating}
              onClick={onRegenerate}
            >
              {regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" title="删除素材" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}
