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

/**
 * 提取管线富产物展示：视觉设定（visual-description）、结构化描述字段与证据
 * （description-fusion）、生成提示词（prompt-generation）。
 * 产物缺失时整节不渲染，不影响原有面板。
 */
export function EntityArtifactsSection({ artifacts }: { artifacts: EntityArtifacts | undefined }) {
  if (!artifacts) return null;
  const fused = artifacts.visual ?? artifacts.description;
  const visual = artifacts.visual;
  const prompt = artifacts.prompt;
  if (!fused && !prompt) return null;

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
