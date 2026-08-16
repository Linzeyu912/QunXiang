import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Eye, EyeOff, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useLlmStatus, useSetLlmConfig, useSetConcurrencyMode, useTestLlmConnection, useLlmPresets,
  useImageStatus, useSetImageConfig, useTestImageConnection, useImagePresets,
  type LlmConfigPatch, type ImageConfigPatch, type ProviderPreset,
} from '@/api/llm';
import type { ConcurrencyMode } from '@/types';

/** 根据已保存的 baseUrl/model 反推出匹配的预设服务商和模型 */
function matchPreset(
  presets: ProviderPreset[],
  baseUrl: string,
  model: string,
): { providerId: string; modelId: string } | null {
  if (!baseUrl) return null;
  for (const p of presets) {
    if (baseUrl === p.baseUrl || baseUrl === p.baseUrl.replace(/\/+$/, '')) {
      const matched = p.models.find((m) => m.id === model);
      return { providerId: p.id, modelId: matched ? matched.id : '' };
    }
  }
  return null;
}

export function LlmSettingsPage() {
  const { data: status, isLoading } = useLlmStatus();
  const { data: presetsData } = useLlmPresets();
  const setConfig = useSetLlmConfig();
  const setMode = useSetConcurrencyMode();
  const test = useTestLlmConnection();

  const presets = presetsData?.presets ?? [];

  // ── 预设选择模式 ──
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  // ── 自定义模式 ──
  const [useCustom, setUseCustom] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');

  // ── 通用 ──
  const [apiKeys, setApiKeys] = useState<string[]>(['']);
  const [showKey, setShowKey] = useState(false);
  const initialized = useRef(false);

  // 当前选中的预设对象
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
      // 已有配置但不匹配任何预设 → 进入自定义模式
      setUseCustom(true);
      setCustomBaseUrl(savedUrl);
      setCustomModel(savedModel);
    }
    initialized.current = true;
  }, [status, presets]);

  // 切换服务商时重置模型选择
  const onProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModelId('');
    setUseCustom(false);
  };

  const updateKey = (index: number, value: string) => {
    setApiKeys((current) => current.map((key, keyIndex) => keyIndex === index ? value : key));
  };

  const addKey = () => setApiKeys((current) => [...current, '']);

  const removeKey = (index: number) => {
    setApiKeys((current) => {
      const next = current.filter((_, keyIndex) => keyIndex !== index);
      return next.length > 0 ? next : [''];
    });
  };

  // 保存
  const save = async () => {
    try {
      const patch: LlmConfigPatch = { provider: 'custom' };

      if (useCustom) {
        // 自定义模式：使用手填的值
        if (customBaseUrl.trim()) patch.baseUrl = customBaseUrl.trim();
        if (customModel.trim()) patch.model = customModel.trim();
      } else {
        // 预设模式：从预设表查 baseUrl，模型 id 直接提交
        if (activePreset) patch.baseUrl = activePreset.baseUrl;
        if (selectedModelId) patch.model = selectedModelId;
      }

      const newKeys = [...new Set(apiKeys.map((key) => key.trim()).filter(Boolean))];
      if (newKeys.length > 0) patch.apiKeys = newKeys;
      const res = await setConfig.mutateAsync(patch);
      if (res.warning) {
        // 保存成功但自动连接测试失败（如接口地址路径错误）——醒目提示，避免带病运行
        toast.warning(res.warning, { duration: 10000 });
      } else {
        toast.success('已保存配置，连接测试通过');
      }
      setApiKeys(['']);
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  };

  const switchMode = async (mode: ConcurrencyMode) => {
    try {
      await setMode.mutateAsync(mode);
      toast.success(mode === 'parallel-books' ? '已切换为优先并行多本' : '已切换为优先单本速度');
    } catch (error) {
      toast.error(`切换失败：${(error as Error).message}`);
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

  if (isLoading) {
    return <LlmSettingsSkeleton />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">服务商设置</h1>
        <p className="text-sm text-muted-foreground">配置 LLM 提取模型与文生图模型</p>
      </div>

      {/* ── 当前状态 ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle>当前状态</CardTitle>
          <div className="flex items-center gap-2">
            {status?.canExtract ? (
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
            <Button
              variant="ghost"
              size="sm"
              onClick={runTest}
              disabled={test.isPending}
              className="h-7 px-2 text-xs"
            >
              {test.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                '测试连接'
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <StatusRow label="服务商">{status?.provider ?? '-'}</StatusRow>
            <StatusRow label="模型">{status?.model || '-'}</StatusRow>
            <StatusRow label="API 密钥">
              {status?.keyCount
                ? `${status.keyCount} 个（${status.keyHints?.join(' / ') || status.keyHint}）`
                : '未设置'}
            </StatusRow>
            <StatusRow label="接口地址">
              <span className="text-muted-foreground">{status?.baseUrl || '-'}</span>
            </StatusRow>
          </div>
          {status?.error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">配置错误</p>
              <p className="mt-1 text-xs">{status.error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 修改配置 ── */}
      <Card>
        <CardHeader>
          <CardTitle>修改配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 服务商选择 */}
          <div className="space-y-1.5">
            <Label>服务商</Label>
            <Select value={useCustom ? '__custom__' : selectedProviderId} onValueChange={(v) => {
              if (v === '__custom__') {
                setUseCustom(true);
                // 如果之前有预设选中，把 baseUrl 回填到自定义框
                if (activePreset && !customBaseUrl) setCustomBaseUrl(activePreset.baseUrl);
              } else {
                onProviderChange(v);
              }
            }}>
              <SelectTrigger>
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
              <Label>模型</Label>
              <Select
                value={selectedModelId}
                onValueChange={setSelectedModelId}
                disabled={!activePreset}
              >
                <SelectTrigger>
                  <SelectValue placeholder={activePreset ? '选择模型' : '请先选择服务商'} />
                </SelectTrigger>
                <SelectContent>
                  {activeModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 自定义模式：手填 baseUrl + model */}
          {useCustom && (
            <>
              <div className="space-y-1.5">
                <Label>接口地址</Label>
                <Input
                  name="llm-base-url"
                  autoComplete="off"
                  placeholder="https://api.openai.com/v1"
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  可填写 /v1 根地址或完整 /chat/completions 地址，后端会自动兼容。
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>模型名称</Label>
                <Input
                  name="llm-model"
                  autoComplete="off"
                  placeholder="gpt-4o-mini"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                />
              </div>
            </>
          )}

          {/* API Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>API 密钥（支持多个）</Label>
              <Button type="button" variant="outline" size="sm" onClick={addKey}>
                <Plus className="mr-1 h-3.5 w-3.5" />新增密钥
              </Button>
            </div>
            {status?.keyHints && status.keyHints.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {status.keyHints.map((hint, index) => (
                  <Badge key={`${hint}-${index}`} variant="secondary" className="font-mono">{hint}</Badge>
                ))}
              </div>
            )}
            {apiKeys.map((key, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    name={`llm-api-key-${index}`}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="输入新密钥；全部留空则保留已保存密钥"
                    value={key}
                    onChange={(event) => updateKey(index, event.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((visible) => !visible)}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {apiKeys.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeKey(index)} aria-label="删除密钥输入框">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              填写新密钥后会整体替换当前密钥列表；全部留空保存则保留现有密钥。
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={save} disabled={setConfig.isPending}>
              {setConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存配置
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>并发模式</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            多密钥可用于并行处理多本书，也可以集中处理当前一本。
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ModeOption
              active={status?.concurrency?.mode === 'parallel-books'}
              disabled={setMode.isPending}
              onClick={() => switchMode('parallel-books')}
              title="优先并行多本"
              description={`工作进程数跟随密钥数${status?.concurrency ? `，当前 ${status.concurrency.workers} 个` : ''}`}
            />
            <ModeOption
              active={status?.concurrency?.mode === 'single-book-speed'}
              disabled={setMode.isPending}
              onClick={() => switchMode('single-book-speed')}
              title="优先单本速度"
              description="使用一个工作进程，把调用额度集中给当前书籍"
            />
          </div>
          {status?.concurrency && (
            <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
              已检测到 {status.concurrency.keyCount} 个密钥，建议可同时处理 {status.concurrency.recommended} 本书。
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 文生图设置 ── */}
      <ImageSettingsCard />
    </div>
  );
}

function ModeOption({
  active,
  disabled,
  onClick,
  title,
  description,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-colors ${active ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'}`}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
        {title}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

/** 文生图设置卡片 */
function ImageSettingsCard() {
  const { data: status, isLoading } = useImageStatus();
  const { data: presetsData } = useImagePresets();
  const setConfig = useSetImageConfig();
  const test = useTestImageConnection();

  const presets = presetsData?.presets ?? [];

  // ── 预设选择模式 ──
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  // ── 自定义模式 ──
  const [useCustom, setUseCustom] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');

  // ── 通用 ──
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [size, setSize] = useState('');
  const [characterRatio, setCharacterRatio] = useState('');
  const [itemRatio, setItemRatio] = useState('');
  const [locationRatio, setLocationRatio] = useState('');

  const activePreset = presets.find((p) => p.id === selectedProviderId);
  const activeModels = activePreset?.models ?? [];

  // 初始化：根据已保存的 baseUrl/model 反推预设
  useEffect(() => {
    if (!status || presets.length === 0) return;
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
  }, [status, presets]);

  const onProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModelId('');
    setSize('');
    setUseCustom(false);
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
      console.log('[image-config] save:', { useCustom, selectedModelId, matchedModel: matchedModel?.id, defaultSize: matchedModel?.defaultSize, effectiveSize });
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
          <p className="col-span-2 text-xs text-destructive">{status.error}</p>
        )}
      </CardContent>

      <CardContent className="space-y-4">
        <Separator />
        <p className="text-sm font-medium">修改配置</p>
        <p className="text-xs text-muted-foreground">
          使用兼容 OpenAI <code>/v1/images/generations</code> 协议的文生图接口。
        </p>

        {/* 服务商选择 */}
        <div className="space-y-1.5">
          <Label>服务商</Label>
          <Select value={useCustom ? '__custom__' : selectedProviderId} onValueChange={(v) => {
            if (v === '__custom__') {
              setUseCustom(true);
              if (activePreset && !customBaseUrl) setCustomBaseUrl(activePreset.baseUrl);
            } else {
              onProviderChange(v);
            }
          }}>
            <SelectTrigger>
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
            <Label>模型</Label>
            <Select
              value={selectedModelId}
              onValueChange={onModelChange}
              disabled={!activePreset}
            >
              <SelectTrigger>
                <SelectValue placeholder={activePreset ? '选择模型' : '请先选择服务商'} />
              </SelectTrigger>
              <SelectContent>
                {activeModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activePreset && (
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
              <Label>接口地址</Label>
              <Input
                name="image-base-url"
                autoComplete="off"
                placeholder="https://api.openai.com/v1"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                可填 /v1 根地址或完整 /images/generations 地址。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>模型名称</Label>
              <Input
                name="image-model"
                autoComplete="off"
                placeholder="reve/create-image"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
              />
            </div>
          </>
        )}

        {/* API Key */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>API 密钥</Label>
            {status?.keyHint && (
              <span className="font-mono text-xs text-muted-foreground">当前：{status.keyHint}</span>
            )}
          </div>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              name="image-api-key"
              autoComplete="off"
              placeholder="输入新密钥可覆盖（留空保存则保留当前值）"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* 图片尺寸：预设模式自动填充，自定义模式可手填 */}
        <div className="space-y-1.5">
          <Label>图片尺寸</Label>
          {!useCustom && selectedModelId ? (
            <div className="flex items-center gap-2">
              <Input
                value={activeModels.find((m) => m.id === selectedModelId)?.defaultSize || ''}
                readOnly
                className="bg-muted/50"
              />
              <span className="text-xs text-muted-foreground">（跟随模型自动设置）</span>
            </div>
          ) : (
            <Input
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
            <Label className="text-xs">角色 (Character)</Label>
            <Input
              placeholder="3:4"
              value={characterRatio}
              onChange={(e) => setCharacterRatio(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">道具 (Item)</Label>
            <Input
              placeholder="1:1"
              value={itemRatio}
              onChange={(e) => setItemRatio(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">场景 (Location)</Label>
            <Input
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

function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-xs">{children}</p>
    </div>
  );
}
/** LLM 设置页加载骨架：标题 + 状态卡 + 配置表单卡占位，贴合真实布局。 */
function LlmSettingsSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-label="设置加载中">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-14" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
