import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useLlmStatus, useSetLlmConfig, useTestLlmConnection, useLlmPresets,
  type LlmConfigPatch,
} from '@/api/llm';
import { matchPreset } from './provider-utils';
import { StatusRow } from './StatusRow';
import { SecretInput } from './SecretInput';
import { ProviderFields } from './ProviderFields';

/** 文本模型：当前状态 + 修改配置（服务商/模型/多密钥），保存时机与请求体与原页面一致。 */
export function TextModelSection() {
  const { data: status } = useLlmStatus();
  const { data: presetsData } = useLlmPresets();
  const setConfig = useSetLlmConfig();
  const test = useTestLlmConnection();

  const presets = useMemo(() => presetsData?.presets ?? [], [presetsData]);

  // ── 预设选择模式 ──
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  // ── 自定义模式 ──
  const [useCustom, setUseCustom] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');

  // ── 通用 ──
  const [apiKeys, setApiKeys] = useState<string[]>(['']);
  const initialized = useRef(false);

  // 当前选中的预设对象
  const activePreset = presets.find((p) => p.id === selectedProviderId);

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

  const onProviderSelect = (v: string) => {
    if (v === '__custom__') {
      setUseCustom(true);
      // 如果之前有预设选中，把 baseUrl 回填到自定义框
      if (activePreset && !customBaseUrl) setCustomBaseUrl(activePreset.baseUrl);
    } else {
      onProviderChange(v);
    }
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

  const runTest = async () => {
    try {
      const res = await test.mutateAsync();
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch (e) {
      toast.error(`测试失败：${(e as Error).message}`);
    }
  };

  return (
    <>
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
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
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
          <ProviderFields
            presets={presets}
            selectedProviderId={selectedProviderId}
            activePreset={activePreset}
            selectedModelId={selectedModelId}
            useCustom={useCustom}
            customBaseUrl={customBaseUrl}
            customModel={customModel}
            customModelPlaceholder="gpt-4o-mini"
            customBaseUrlHint="可填写 /v1 根地址或完整 /chat/completions 地址，后端会自动兼容。"
            baseUrlInputName="llm-base-url"
            modelInputName="llm-model"
            onProviderSelect={onProviderSelect}
            onModelChange={setSelectedModelId}
            onCustomBaseUrlChange={setCustomBaseUrl}
            onCustomModelChange={setCustomModel}
          />

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
                <SecretInput
                  name={`llm-api-key-${index}`}
                  placeholder="输入新密钥；全部留空则保留已保存密钥"
                  value={key}
                  onChange={(v) => updateKey(index, v)}
                  className="flex-1"
                />
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
    </>
  );
}
