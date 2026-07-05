import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { EvidenceSnippets } from '@/components/story/EvidenceSnippets';
import { PromptCopyBlock } from '@/components/story/PromptCopyBlock';
import type { EntityArtifacts } from '@/types';

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

const COVERAGE_LABEL: Record<string, string> = {
  strong: '证据充分',
  partial: '证据部分',
  weak: '证据薄弱',
  none: '无证据',
};

const QUALITY_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

function label(key: string): string {
  return FIELD_LABEL[key] ?? key;
}

function FieldGrid({ fields }: { fields: Record<string, string> }) {
  const entries = Object.entries(fields).filter(([, v]) => v && v.trim());
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm md:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{label(k)}</dt>
          <dd className="whitespace-pre-wrap leading-relaxed">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 产物查询状态：用于在产物缺失/加载时给出明确提示，而非整节静默消失。 */
export type ArtifactsQueryState = 'loading' | 'no-run' | 'ready';

/**
 * 提取管线富产物展示：视觉设定（visual-description）、结构化描述字段与证据
 * （description-fusion）、生成提示词（prompt-generation）。
 *
 * 状态说明（避免用户困惑"为什么看不到提示词"）：
 * - loading：产物接口请求中 → 显示"加载产物中…"
 * - no-run：该书还没有任何完成的提取运行 → 显示"尚未生成产物，请先完成提取"
 * - ready：有运行，但当前实体未匹配到产物 → 显示"该实体暂无生成提示词"
 * - ready 且 artifacts 存在：正常渲染视觉设定 / 结构化描述 / 提示词。
 */
export function EntityArtifactsSection({
  artifacts,
  state = 'ready',
}: {
  artifacts: EntityArtifacts | undefined;
  state?: ArtifactsQueryState;
}) {
  // 加载中：永远显示一条提示，让用户知道产物正在读取。
  if (state === 'loading') {
    return (
      <>
        <Separator />
        <div className="text-sm text-muted-foreground">加载提取产物中…</div>
      </>
    );
  }

  // 该书还没有完成的提取运行：明确告知用户去跑提取，而不是什么都不显示。
  if (state === 'no-run') {
    return (
      <>
        <Separator />
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
          本书尚未生成提取产物（视觉设定 / 结构化描述 / 生成提示词）。
          请先在「管道」页完成一次提取。
        </div>
      </>
    );
  }

  // ready 态但当前实体没有匹配到任何产物：提示该实体暂无产物，而非整节消失。
  if (!artifacts) {
    return (
      <>
        <Separator />
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
          该实体暂无生成提示词（可能在本次提取中被判定为低置信度或未参与提示词生成）。
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
          该实体暂无生成提示词。
        </div>
      </>
    );
  }

  return (
    <>
      {visual && (visual.visualDetails || visual.visualFields) && (
        <>
          <Separator />
          <div>
            <h3 className="mb-2 text-sm font-medium">视觉设定</h3>
            {visual.visualDetails && Object.keys(visual.visualDetails).length > 0 ? (
              <FieldGrid fields={visual.visualDetails} />
            ) : (
              visual.visualFields && <FieldGrid fields={visual.visualFields} />
            )}
          </div>
        </>
      )}

      {fused && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">结构化描述</h3>
              {fused.sourceCoverage && (
                <Badge variant={fused.sourceCoverage === 'strong' ? 'success' : 'warning'}>
                  {COVERAGE_LABEL[fused.sourceCoverage] ?? fused.sourceCoverage}
                </Badge>
              )}
              {fused.needsReview && <Badge variant="warning">建议复核</Badge>}
            </div>
            {fused.fields && <FieldGrid fields={fused.fields} />}
            {fused.missingFields && fused.missingFields.length > 0 && (
              <p className="text-xs text-muted-foreground">
                缺失字段：{fused.missingFields.map((f) => label(f)).join('、')}
              </p>
            )}
            {fused.evidenceSnippets && fused.evidenceSnippets.length > 0 && (
              <EvidenceSnippets snippets={fused.evidenceSnippets} />
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
            </div>
            <PromptCopyBlock prompt={prompt.prompt} />
            {prompt.styleTags && prompt.styleTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {prompt.styleTags.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
