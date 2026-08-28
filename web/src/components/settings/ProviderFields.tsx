import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProviderPreset } from '@/api/llm';

/**
 * 服务商/模型选择区块：预设下拉 + 「自定义（手动填写）」切换。
 * 文本模型与文生图模型共用，保证两处交互一致；仅回填/提示语按场景微调。
 */
export function ProviderFields({
  presets,
  selectedProviderId,
  activePreset,
  selectedModelId,
  useCustom,
  customBaseUrl,
  customModel,
  customModelPlaceholder,
  customBaseUrlHint,
  baseUrlInputName,
  modelInputName,
  onProviderSelect,
  onModelChange,
  onCustomBaseUrlChange,
  onCustomModelChange,
  showPresetBaseUrlHint = false,
}: {
  presets: ProviderPreset[];
  selectedProviderId: string;
  activePreset: ProviderPreset | undefined;
  selectedModelId: string;
  useCustom: boolean;
  customBaseUrl: string;
  customModel: string;
  customModelPlaceholder: string;
  customBaseUrlHint: string;
  baseUrlInputName: string;
  modelInputName: string;
  /** 选择预设服务商；传入 '__custom__' 表示切到自定义模式 */
  onProviderSelect: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onCustomBaseUrlChange: (v: string) => void;
  onCustomModelChange: (v: string) => void;
  showPresetBaseUrlHint?: boolean;
}) {
  const activeModels = activePreset?.models ?? [];

  return (
    <>
      {/* 服务商选择 */}
      <div className="space-y-1.5">
        <Label htmlFor={`${baseUrlInputName}-provider`}>服务商</Label>
        <Select value={useCustom ? '__custom__' : selectedProviderId} onValueChange={onProviderSelect}>
          <SelectTrigger id={`${baseUrlInputName}-provider`} aria-label="服务商">
            <SelectValue placeholder="选择服务商" />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
            <SelectItem value="__custom__">自定义（手动填写）</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 预设模式：模型下拉 */}
      {!useCustom && (
        <div className="space-y-1.5">
          <Label htmlFor={`${modelInputName}-select`}>模型</Label>
          <Select
            value={selectedModelId}
            onValueChange={onModelChange}
            disabled={!activePreset}
          >
            <SelectTrigger id={`${modelInputName}-select`} aria-label="模型">
              <SelectValue placeholder={activePreset ? '选择模型' : '请先选择服务商'} />
            </SelectTrigger>
            <SelectContent>
              {activeModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showPresetBaseUrlHint && activePreset && (
            <p className="text-xs text-muted-foreground">
              接口地址：<code className="rounded bg-muted px-1">{activePreset.baseUrl}</code>
            </p>
          )}
        </div>
      )}

      {/* 自定义模式：手填 baseUrl + model */}
      {useCustom && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={baseUrlInputName}>接口地址</Label>
            <Input
              id={baseUrlInputName}
              name={baseUrlInputName}
              autoComplete="off"
              placeholder="https://api.openai.com/v1"
              value={customBaseUrl}
              onChange={(e) => onCustomBaseUrlChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{customBaseUrlHint}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={modelInputName}>模型名称</Label>
            <Input
              id={modelInputName}
              name={modelInputName}
              autoComplete="off"
              placeholder={customModelPlaceholder}
              value={customModel}
              onChange={(e) => onCustomModelChange(e.target.value)}
            />
          </div>
        </>
      )}
    </>
  );
}
