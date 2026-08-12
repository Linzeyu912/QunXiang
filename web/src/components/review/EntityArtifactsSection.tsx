import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Image, Loader2, Star, Trash2, Upload, ChevronDown, ChevronRight, Pencil, Save, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { EvidenceSnippets } from '@/components/story/EvidenceSnippets';
import { PromptCopyBlock } from '@/components/story/PromptCopyBlock';
import {
  useEntityImages,
  useGenerateImage,
  useUploadImage,
  useDeleteImage,
  useSetPrimaryImage,
  useProtectedImageUrl,
} from '@/api/images';
import { useUpdateArtifact } from '@/api/artifacts';
import { cn } from '@/lib/utils';
import type { EntityArtifacts, EntityType, GenerationPromptEntry, OutfitVariantEntry } from '@/types';

// 融合/视觉字段的中文标签；未知键回退显示原始键名
const FIELD_LABEL: Record<string, string> = {
  appearance: '外貌',
  clothing: '服饰',
  body: '体态',
  temperament: '气质神情',
  signatureItems: '标志物',
  abilityVisuals: '能力视觉',
  statusMarkers: '身份线索',
  // visualDetails
  bodyBuild: '身形',
  faceShape: '脸型',
  hair: '发型',
  eyes: '眼睛',
  nose: '鼻',
  lips: '唇',
  skin: '肤色',
  makeupStyling: '妆造',
  // 场景/道具常见键
  material: '材质',
  shape: '形制',
  color: '色彩',
  scale: '尺度',
  atmosphere: '氛围',
  lighting: '光线',
  landmark: '地标特征',
  function: '功能',
  condition: '状态',
};

const QUALITY_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

// 描述区域标题根据实体类型动态切换
const DESCRIPTION_TITLE: Record<EntityType, string> = {
  character: '人物描写',
  location: '场景描写',
  item: '道具描写',
  worldview: '世界观与体系说明',
};

// completionStatus / descriptionSource 的中文标签
const COMPLETION_STATUS_LABEL: Record<string, string> = {
  source_only: '纯原文',
  llm_completed: 'LLM 补全',
  llm_inferred: 'LLM 推断',
  mixed: '混合',
};

const DESCRIPTION_SOURCE_LABEL: Record<string, string> = {
  source: '原文',
  llm: 'LLM',
  mixed: '混合',
};

function label(key: string): string {
  return FIELD_LABEL[key] ?? key;
}

/** 分字段详情：默认折叠，点击展开查看各维度的字段值。 */
function FieldDetails({
  fields,
  label: labelFn,
  title = '分字段详情',
}: {
  fields: Record<string, string>;
  label: (key: string) => string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(fields).filter(([, v]) => v && v.trim());
  if (entries.length === 0) return null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title} ({entries.length})
      </button>
      {open && (
        <dl className="space-y-1.5 rounded-md bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-1.5">
              <dt className="shrink-0 font-medium text-foreground/70">{labelFn(k)}</dt>
              <dd className="whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** ── 提示词多版本（按年龄阶段）：单阶段退化为单条 PromptCopyBlock ── */
function PromptVariants({
  prompt,
  stage,
  onStageChange,
}: {
  prompt: GenerationPromptEntry;
  stage?: string;
  onStageChange: (s?: string) => void;
}) {
  const variants = prompt.variants ?? [];
  if (variants.length <= 1) {
    return <PromptCopyBlock prompt={prompt.prompt} />;
  }
  const current =
    variants.find((v) => v.stage === stage) ?? variants.find((v) => v.isPrimary) ?? variants[0];
  return (
    <div className="space-y-2">
      <Tabs value={current.stage} onValueChange={onStageChange}>
        <TabsList>
          {variants.map((v) => (
            <TabsTrigger key={v.stage} value={v.stage}>
              {v.label}
              {v.isPrimary && ' ★'}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={current.stage} className="space-y-1">
          <PromptCopyBlock prompt={current.prompt} />
          {current.sourceChapters && (
            <p className="text-xs text-muted-foreground">原文依据：{current.sourceChapters}</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** ── 实体图片画廊（多张：AI 生成 + 用户上传，DB 持久化，刷新自动显示）── */
function EntityImageGallery({
  bookId,
  entityType,
  entityName,
  stage,
  outfits,
}: {
  bookId: string;
  entityType: EntityType;
  entityName: string;
  stage?: string;
  /** 服饰套系变体（仅角色）：非空时生图可选套系 */
  outfits?: OutfitVariantEntry[];
}) {
  const q = useEntityImages(bookId, entityType, entityName);
  const generate = useGenerateImage(bookId);
  const upload = useUploadImage(bookId);
  const del = useDeleteImage(bookId);
  const setPrimary = useSetPrimaryImage(bookId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  // 服饰套系选择（'PRIMARY' = 主套，其余为 scene/描述标签）
  const [outfitPick, setOutfitPick] = useState<string>('PRIMARY');

  // 切换 stage 过滤时清除选中，避免引用已过滤掉的图片
  const handleStageFilter = (s: string | null) => {
    setSelectedId(null);
    setStageFilter(s);
  };

  const allImages = q.data ?? [];
  // 按 stage 过滤
  const images = stageFilter ? allImages.filter((i) => i.stage === stageFilter) : allImages;
  // 当前大图：手动选中优先，否则主图，否则首张
  const featured = images.find((i) => i.id === selectedId) ?? images.find((i) => i.isPrimary) ?? images[0];

  // 收集所有已有 stage 标签（去重 + 排序）
  const stageTabs = Array.from(
    new Set(allImages.map((i) => i.stage).filter((s): s is string => !!s)),
  ).sort();

  const handleGenerate = async () => {
    try {
      const outfit = outfitPick !== 'PRIMARY' ? outfitPick : undefined;
      await generate.mutateAsync({ type: entityType, name: entityName, stage, outfit });
      toast.success(`${entityName} 图片已生成${outfit ? `（套系：${outfit}）` : ''}`);
    } catch (err) {
      toast.error(`生图失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await upload.mutateAsync({ type: entityType, name: entityName, file });
      toast.success('图片已上传');
    } catch (err) {
      toast.error(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (imageId: string) => {
    try {
      await del.mutateAsync({ imageId, type: entityType, name: entityName });
      toast.success('已删除');
      if (selectedId === imageId) setSelectedId(null);
    } catch (err) {
      toast.error(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    try {
      await setPrimary.mutateAsync({ imageId, type: entityType, name: entityName });
      toast.success('已设为主图');
    } catch (err) {
      toast.error(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const busy = generate.isPending || upload.isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">实体图片</span>
        <Button variant="outline" size="sm" className="gap-1" disabled={busy} onClick={handleGenerate}>
          {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Image className="h-3.5 w-3.5" />}
          AI 生成
        </Button>
        {outfits && outfits.length > 0 && (
          <Select value={outfitPick} onValueChange={setOutfitPick}>
            <SelectTrigger className="h-9 w-40 text-xs" title="选择服饰套系">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PRIMARY">主套服饰</SelectItem>
              {outfits.map((o, i) => (
                <SelectItem key={i} value={o.scene || o.description.slice(0, 20) || `套系${i + 1}`}>
                  {o.scene || o.description.slice(0, 20) || `套系${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="sm" className="gap-1" disabled={busy} onClick={() => fileInput.current?.click()}>
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          上传图片
        </Button>
        <input
          ref={fileInput}
          type="file"
          title="上传实体图片"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            handleFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {stageTabs.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">筛选：</span>
          <Button
            variant={stageFilter === null ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => handleStageFilter(null)}
          >
            全部
          </Button>
          {stageTabs.map((s) => (
            <Button
              key={s}
              variant={stageFilter === s ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => handleStageFilter(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {generate.isPending ? `正在生成 ${entityName} 的图片，请稍候（5-30 秒）…` : '正在上传图片…'}
        </div>
      )}

      {q.isLoading ? (
        <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载图片…
        </div>
      ) : images.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {stageFilter ? `暂无「${stageFilter}」阶段图片。` : '暂无图片，点击「AI 生成」或「上传图片」。'}
        </p>
      ) : (
        <>
          {featured && (
            <div className="relative overflow-hidden rounded-md border bg-muted/10">
              <ProtectedEntityImage
                bookId={bookId}
                imageId={featured.id}
                alt={`${entityName} 图片`}
                className="max-h-[480px] w-full object-contain"
                loading="lazy"
                onError={() => toast.error('图片加载失败')}
              />
              <div className="absolute right-1.5 top-1.5 flex gap-1">
                <Badge variant={featured.source === 'generated' ? 'secondary' : 'outline'}>
                  {featured.source === 'generated' ? 'AI 生成' : '手动上传'}
                </Badge>
                {featured.isPrimary && <Badge variant="success">主图</Badge>}
                {featured.stage && <Badge variant="outline">{featured.stage}</Badge>}
              </div>
            </div>
          )}

          {images.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => (
                <div
                  key={img.id}
                  className={cn(
                    'group relative overflow-hidden rounded-md border',
                    img.id === featured?.id ? 'ring-2 ring-primary' : '',
                  )}
                >
                  <button type="button" onClick={() => setSelectedId(img.id)} className="block">
                    <ProtectedEntityImage
                      bookId={bookId}
                      imageId={img.id}
                      alt={img.entityName}
                      className="h-20 w-20 object-cover"
                      loading="lazy"
                    />
                  </button>
                  {img.stage && (
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                      {img.stage}
                    </span>
                  )}
                  {!img.isPrimary && (
                    <button
                      type="button"
                      title="设为主图"
                      disabled={setPrimary.isPending}
                      onClick={() => handleSetPrimary(img.id)}
                      className="absolute left-0.5 top-0.5 rounded bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-amber-500 group-hover:opacity-100"
                    >
                      <Star className="h-3 w-3" />
                    </button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        title="删除"
                        disabled={del.isPending}
                        className="absolute right-0.5 top-0.5 rounded bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>删除这张图片？</AlertDialogTitle>
                        <AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(img.id)}>确认删除</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** ── 服饰套系提示词（非主套的完整四视图，可折叠查看/复制/按套生图）── */
function OutfitPromptsSection({
  bookId,
  entityType,
  entityName,
  outfits,
}: {
  bookId: string;
  entityType: EntityType;
  entityName: string;
  outfits: OutfitVariantEntry[];
}) {
  const [open, setOpen] = useState(false);
  const generate = useGenerateImage(bookId);

  const handleGenerateOutfit = async (o: OutfitVariantEntry, i: number) => {
    try {
      await generate.mutateAsync({
        type: entityType,
        name: entityName,
        outfit: o.scene || o.description.slice(0, 20) || `套系${i + 1}`,
      });
      toast.success(`${entityName}（${o.scene || `套系${i + 1}`}）图片已生成`);
    } catch (err) {
      toast.error(`生图失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-accent/50"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        服饰套系提示词（{outfits.length} 套非主套）
        <span className="text-xs font-normal text-muted-foreground">每套均为完整四视图，生图时可按套系选择</span>
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {outfits.map((o, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{o.scene || `套系${i + 1}`}</Badge>
                {o.sourceChapters && (
                  <span className="text-xs text-muted-foreground">{o.sourceChapters}</span>
                )}
                {o.source === 'llm-polished' && <Badge variant="secondary">LLM 补写</Badge>}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-7 gap-1 px-2 text-xs"
                  disabled={generate.isPending}
                  onClick={() => handleGenerateOutfit(o, i)}
                >
                  {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Image className="h-3.5 w-3.5" />}
                  生成这套
                </Button>
              </div>
              <PromptCopyBlock label={o.description} prompt={o.prompt} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProtectedEntityImage({
  bookId,
  imageId,
  ...props
}: { bookId: string; imageId: string } & React.ImgHTMLAttributes<HTMLImageElement>) {
  const src = useProtectedImageUrl(bookId, imageId);
  return <img {...props} src={src ?? undefined} />;
}

/**
 * 可编辑的字段区域：默认展示模式，点击"编辑"切换为编辑模式。
 */
function EditableField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[80px] text-sm"
        />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="text-sm" />
      )}
    </div>
  );
}

/**
 * 可编辑的字段 Map 区域（如 visualFields / visualDetails）。
 */
function EditableFieldMap({
  label: sectionLabel,
  fields,
  onChange,
}: {
  label: string;
  fields: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const entries = Object.entries(fields).filter(([, v]) => v && v.trim());
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{sectionLabel}</p>
      {entries.map(([k, v]) => (
        <EditableField
          key={k}
          label={label(k)}
          value={v}
          onChange={(newVal) => onChange({ ...fields, [k]: newVal })}
          multiline
        />
      ))}
    </div>
  );
}

/**
 * 提取管线富产物展示：视觉设定（visual-description）、结构化描述字段与证据
 * （description-fusion）、生成提示词（prompt-generation）。
 * 产物缺失时整节不渲染，不影响原有面板。
 *
 * 支持人工编辑：描写区（enhancedDescription/llmSupplement/visualFields/visualDetails）
 * 和提示词区（prompt/variants）均可编辑后保存。
 */
export type ArtifactsQueryState = 'loading' | 'no-run' | 'ready';

export function EntityArtifactsSection({
  artifacts,
  bookId,
  entityType,
  entityName,
  state = 'ready',
}: {
  artifacts: EntityArtifacts | undefined;
  bookId: string;
  entityType: EntityType;
  entityName: string;
  state?: ArtifactsQueryState;
}) {
  const [stage, setStage] = useState<string | undefined>(undefined);
  const updateMutation = useUpdateArtifact(bookId, entityType, entityName);

  // ── 编辑状态 ──
  const [editingDesc, setEditingDesc] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);

  // 描写编辑表单
  const [editEnhanced, setEditEnhanced] = useState('');
  const [editLlmSupplement, setEditLlmSupplement] = useState('');
  const [editVisualFields, setEditVisualFields] = useState<Record<string, string>>({});
  const [editVisualDetails, setEditVisualDetails] = useState<Record<string, string>>({});

  // 提示词编辑表单
  const [editPrompt, setEditPrompt] = useState('');
  const [editVariants, setEditVariants] = useState<Array<{ stage: string; prompt: string }>>([]);

  if (state === 'loading') {
    return (
      <>
        <Separator />
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
          正在加载实体产物…
        </div>
      </>
    );
  }
  if (state === 'no-run') {
    return (
      <>
        <Separator />
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
          尚未生成实体产物，请先在“管道”页完成一次提取。
        </div>
      </>
    );
  }
  if (!artifacts) {
    return (
      <>
        <Separator />
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
          当前实体暂无视觉设定或生成提示词。
        </div>
      </>
    );
  }
  const fused = artifacts.visual ?? artifacts.description;
  const visual = artifacts.visual;
  const prompt = artifacts.prompt;
  if (!fused && !prompt) {
    return (
      <>
        <Separator />
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
          当前实体暂无视觉设定或生成提示词。
        </div>
      </>
    );
  }

  // ── 描写编辑：进入/保存/取消 ──
  const startEditDesc = () => {
    setEditEnhanced(visual?.enhancedDescription || visual?.finalDescription || fused?.sourceDescription || '');
    setEditLlmSupplement(visual?.llmSupplement || '');
    setEditVisualFields({ ...(visual?.visualFields ?? {}) });
    setEditVisualDetails({ ...(visual?.visualDetails ?? {}) });
    setEditingDesc(true);
  };

  const saveDesc = async () => {
    try {
      await updateMutation.mutateAsync({
        visual: {
          enhancedDescription: editEnhanced,
          llmSupplement: editLlmSupplement,
          visualFields: editVisualFields,
          visualDetails: editVisualDetails,
        },
      });
      toast.success('描写已保存');
      setEditingDesc(false);
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  };

  // ── 提示词编辑：进入/保存/取消 ──
  const startEditPrompt = () => {
    setEditPrompt(prompt?.prompt || '');
    setEditVariants(prompt?.variants?.map((v) => ({ stage: v.stage, prompt: v.prompt })) ?? []);
    setEditingPrompt(true);
  };

  const savePrompt = async () => {
    try {
      await updateMutation.mutateAsync({
        prompt: {
          prompt: editPrompt,
          variants: editVariants.length > 0 ? editVariants : undefined,
        },
      });
      toast.success('提示词已保存');
      setEditingPrompt(false);
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  };

  return (
    <>
      {(visual || fused) && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{DESCRIPTION_TITLE[entityType]}</h3>
              {visual?.completionStatus && (
                <Badge variant="outline">
                  {COMPLETION_STATUS_LABEL[visual.completionStatus] ?? visual.completionStatus}
                </Badge>
              )}
              {visual?.descriptionSource && (
                <Badge variant="muted">
                  来源：{DESCRIPTION_SOURCE_LABEL[visual.descriptionSource] ?? visual.descriptionSource}
                </Badge>
              )}
              <div className="ml-auto flex gap-1">
                {editingDesc ? (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" onClick={() => setEditingDesc(false)}>
                      <X className="h-3.5 w-3.5" /> 取消
                    </Button>
                    <Button size="sm" variant="default" className="h-7 px-2 gap-1" onClick={saveDesc} disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" onClick={startEditDesc}>
                    <Pencil className="h-3.5 w-3.5" /> 编辑
                  </Button>
                )}
              </div>
            </div>

            {editingDesc ? (
              <div className="space-y-3">
                <EditableField label="概括性描述" value={editEnhanced} onChange={setEditEnhanced} multiline />
                <EditableField label="LLM 补写" value={editLlmSupplement} onChange={setEditLlmSupplement} multiline />
                <EditableFieldMap label="视觉字段" fields={editVisualFields} onChange={setEditVisualFields} />
                <EditableFieldMap label="结构化细分" fields={editVisualDetails} onChange={setEditVisualDetails} />
              </div>
            ) : (
              <>
                {(() => {
                  const summary = visual?.enhancedDescription || visual?.finalDescription || fused?.sourceDescription || '';
                  const trimmed = summary.trim();
                  if (trimmed) {
                    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{trimmed}</p>;
                  }
                  return null;
                })()}
                {visual?.llmSupplement && visual.llmSupplement.trim() && (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium">补写：</span>{visual.llmSupplement}
                  </p>
                )}
                {visual?.visualFields && Object.values(visual.visualFields).some((v) => v && v.trim()) && (
                  <FieldDetails fields={visual.visualFields} label={label} title="视觉字段" />
                )}
                {visual?.visualDetails && Object.values(visual.visualDetails).some((v) => v && v.trim()) && (
                  <FieldDetails fields={visual.visualDetails} label={label} title="结构化细分" />
                )}
                {fused?.fields && Object.values(fused.fields).some((v) => v && v.trim()) && (
                  <FieldDetails fields={fused.fields} label={label} title="原文字段" />
                )}
                {fused?.evidenceSnippets && fused.evidenceSnippets.length > 0 && (
                  <EvidenceSnippets snippets={fused.evidenceSnippets} />
                )}
              </>
            )}
          </div>
        </>
      )}

      {prompt && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">生成提示词</h3>
              {prompt.quality && (
                <Badge variant={prompt.quality === 'high' ? 'success' : 'muted'}>
                  质量：{QUALITY_LABEL[prompt.quality] ?? prompt.quality}
                </Badge>
              )}
              {prompt.source && <Badge variant="outline">{prompt.source}</Badge>}
              <div className="ml-auto flex gap-1">
                {editingPrompt ? (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" onClick={() => setEditingPrompt(false)}>
                      <X className="h-3.5 w-3.5" /> 取消
                    </Button>
                    <Button size="sm" variant="default" className="h-7 px-2 gap-1" onClick={savePrompt} disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" onClick={startEditPrompt}>
                    <Pencil className="h-3.5 w-3.5" /> 编辑
                  </Button>
                )}
              </div>
            </div>

            {editingPrompt ? (
              <div className="space-y-3">
                {editVariants.length > 1 ? (
                  <Tabs value={editVariants.find((v) => v.stage === stage)?.stage ?? editVariants[0]?.stage} onValueChange={setStage}>
                    <TabsList>
                      {editVariants.map((v) => (
                        <TabsTrigger key={v.stage} value={v.stage}>{v.stage}</TabsTrigger>
                      ))}
                    </TabsList>
                    {editVariants.map((v, i) => (
                      <TabsContent key={v.stage} value={v.stage}>
                        <Textarea
                          value={v.prompt}
                          onChange={(e) => {
                            const next = [...editVariants];
                            next[i] = { ...next[i], prompt: e.target.value };
                            setEditVariants(next);
                          }}
                          className="min-h-[120px] font-mono text-xs"
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                ) : (
                  <Textarea
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    className="min-h-[120px] font-mono text-xs"
                  />
                )}
              </div>
            ) : (
              <>
                <PromptVariants prompt={prompt} stage={stage} onStageChange={setStage} />
                {prompt.styleTags && prompt.styleTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {prompt.styleTags.map((t) => (
                      <Badge key={t} variant="secondary">{t}</Badge>
                    ))}
                  </div>
                )}
                {prompt.outfitVariants && prompt.outfitVariants.length > 0 && (
                  <OutfitPromptsSection
                    bookId={bookId}
                    entityType={entityType}
                    entityName={entityName}
                    outfits={prompt.outfitVariants}
                  />
                )}
              </>
            )}

            <Separator />
            <EntityImageGallery bookId={bookId} entityType={entityType} entityName={entityName} stage={stage} outfits={prompt.outfitVariants} />
          </div>
        </>
      )}
    </>
  );
}
