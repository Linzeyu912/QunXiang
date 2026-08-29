import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  useImageStatus, useSetImageConfig, useTestImageConnection, useImagePresets,
  type ImageConfigPatch,
} from '@/api/llm';
import { matchPreset } from './provider-utils';
import { StatusRow } from './StatusRow';
import { SecretInput } from './SecretInput';
import { ProviderFields } from './ProviderFields';

/** 文生图模型：状态 + 修改配置（服务商/模型/密钥/尺寸/宽高比），保存语义与原页面一致。 */
export function ImageModelSection() {
  const { data: status, isLoading } = useImageStatus();
  const { data: presetsData } = useImagePresets();
  const setConfig = useSetImageConfig();
  const test = useTestImageConnection();

  const presets = useMemo(() => presetsData?.presets ?? [], [presetsData]);

  // ── 预设选择模式 ──
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  // ── 自定义模式 ──
  const [useCustom, setUseCustom] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');

  // ── 通用 ──
  const [apiKey, setApiKey] = useState('');
  const [size, setSize] = useState('');
  const [characterRatio, setCharacterRatio] = useState('');
  const [itemRatio, setItemRatio] = useState('');
  const [locationRatio, setLocationRatio] = useState('');
  // 初始化只做一次：保存后 status 引用变化（refetch）不得覆盖用户正在编辑的内容
  const initialized = useRef(false);

  const activePreset = presets.find((p) => p.id === selectedProviderId);
  const activeModels = activePreset?.models ?? [];

  // 初始化：根据已保存的 baseUrl/model 反推预设
  useEffect(() => {
    if (!status || presets.length === 0 || initialized.current) return;
    const savedUrl = status.baseUrl || '';
    const savedModel = status.model || '';
    const match = matchPreset(presets, savedUrl, savedModel);
    if (match && match.providerId) {
      setSelectedProviderId(match.providerId);
      setSelectedModelId(match.modelId);
      setUseCustom(false);
    } else if (savedUrl || savedModel) {
      setUseCustom(true);
      setCustomBaseUrl(savedUrl);
      setCustomModel(savedModel);
    }
    setSize(status.size || '');
    setCharacterRatio(status.characterRatio || '');
    setItemRatio(status.itemRatio || '');
    setLocationRatio(status.locationRatio || '');
    initialized.current = true;
  }, [status, presets]);

  const onProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModelId('');
    setSize('');
    setUseCustom(false);
  };

  const onProviderSelect = (v: string) => {
    if (v === '__custom__') {
      setUseCustom(true);
      if (activePreset && !customBaseUrl) setCustomBaseUrl(activePreset.baseUrl);
    } else {
      onProviderChange(v);
    }
  };

  const onModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
    // 自动填充该模型的默认 size
    const model = activeModels.find((m) => m.id === modelId);
    if (model?.defaultSize) {
      setSize(model.defaultSize);
    }
  };

  const save = async () => {
    try {
      const patch: ImageConfigPatch = {};

      if (useCustom) {
        if (customBaseUrl.trim()) patch.baseUrl = customBaseUrl.trim();
        if (customModel.trim()) patch.model = customModel.trim();
      } else {
        if (activePreset) patch.baseUrl = activePreset.baseUrl;
        if (selectedModelId) patch.model = selectedModelId;
      }

      if (apiKey.trim()) patch.apiKey = apiKey.trim();
      // size: 预设模式下自动从模型获取，自定义模式用手填值
      const matchedModel = activeModels.find((m) => m.id === selectedModelId);
      const effectiveSize = useCustom ? size.trim() : (matchedModel?.defaultSize || size.trim());
      if (effectiveSize) patch.size = effectiveSize;
      if (characterRatio.trim()) patch.characterRatio = characterRatio.trim();
      if (itemRatio.trim()) patch.itemRatio = itemRatio.trim();
      if (locationRatio.trim()) patch.locationRatio = locationRatio.trim();
      await setConfig.mutateAsync(patch);
      toast.success('图片配置已保存');
      setApiKey('');
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  };

  const runTest = async () => {
    try {
      const res = await test.mutateAsync();
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch (e) {
      toast.error(`测试失败：${(e as Error).message}`);
    }
  };

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle>文生图服务商</CardTitle>
        {status?.configured ? (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            就绪
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            未就绪
          </Badge>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        <StatusRow label="服务商">{status?.provider ?? '-'}</StatusRow>
        <StatusRow label="模型">{status?.model || '-'}</StatusRow>
        <StatusRow label="接口地址">{status?.baseUrl || '-'}</StatusRow>
        <StatusRow label="API 密钥">{status?.keyHint || '未设置'}</StatusRow>
        {status?.error && (
          <p className="col-span-2 text-xs text-destructive" role="alert">{status.error}</p>
        )}
      </CardContent>

      <CardContent className="space-y-4">
        <Separator />
        <p className="text-sm font-medium">修改配置</p>
        <p className="text-xs text-muted-foreground">
          使用兼容 OpenAI <code>/v1/images/generations</code> 协议的文生图接口。
        </p>

        <ProviderFields
          presets={presets}
          selectedProviderId={selectedProviderId}
          activePreset={activePreset}
          selectedModelId={selectedModelId}
          useCustom={useCustom}
          customBaseUrl={customBaseUrl}
          customModel={customModel}
          customModelPlaceholder="reve/create-image"
          customBaseUrlHint="可填 /v1 根地址或完整 /images/generations 地址。"
          baseUrlInputName="image-base-url"
          modelInputName="image-model"
          onProviderSelect={onProviderSelect}
          onModelChange={onModelChange}
          onCustomBaseUrlChange={setCustomBaseUrl}
          onCustomModelChange={setCustomModel}
          showPresetBaseUrlHint
        />

        {/* API Key */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="image-api-key">API 密钥</Label>
            {status?.keyHint && (
              <span className="font-mono text-xs text-muted-foreground">当前：{status.keyHint}</span>
            )}
          </div>
          <SecretInput
            id="image-api-key"
            name="image-api-key"
            placeholder="输入新密钥可覆盖（留空保存则保留当前值）"
            value={apiKey}
            onChange={setApiKey}
          />
        </div>

        {/* 图片尺寸：预设模式自动填充，自定义模式可手填 */}
        <div className="space-y-1.5">
          <Label htmlFor="image-size">图片尺寸</Label>
          {!useCustom && selectedModelId ? (
            <div className="flex items-center gap-2">
              <Input
                id="image-size"
                value={activeModels.find((m) => m.id === selectedModelId)?.defaultSize || ''}
                readOnly
                className="bg-muted/50"
              />
              <span className="shrink-0 text-xs text-muted-foreground">（跟随模型自动设置）</span>
            </div>
          ) : (
            <Input
              id="image-size"
              name="image-size"
              autoComplete="off"
              placeholder="1024x1024 或 2K（留空则使用宽高比）"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Seedream 用 <code className="rounded bg-muted px-1">2K</code>，OpenAI/SiliconFlow 用 <code className="rounded bg-muted px-1">1024x1024</code>，Reve 留空。
          </p>
        </div>

        <Separator />
        <p className="text-sm font-medium">默认宽高比（可按实体类型覆盖）</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ratio-character">角色 (Character)</Label>
            <Input
              id="ratio-character"
              placeholder="3:4"
              value={characterRatio}
              onChange={(e) => setCharacterRatio(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ratio-item">道具 (Item)</Label>
            <Input
              id="ratio-item"
              placeholder="1:1"
              value={itemRatio}
              onChange={(e) => setItemRatio(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ratio-location">场景 (Location)</Label>
            <Input
              id="ratio-location"
              placeholder="16:9"
              value={locationRatio}
              onChange={(e) => setLocationRatio(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={save} disabled={setConfig.isPending}>
            {setConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存
          </Button>
          <Button variant="outline" onClick={runTest} disabled={test.isPending}>
            {test.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            测试连接
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
