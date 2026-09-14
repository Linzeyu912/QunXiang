import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck, Loader2, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useLlmPresets,
  useLlmProfiles,
  useCreateLlmProfile,
  useUpdateLlmProfile,
  useDeleteLlmProfile,
  useActivateLlmProfile,
  useTestLlmProfile,
  type LlmProfileInput,
  type LlmProfileView,
} from '@/api/llm';
import { matchPreset } from './provider-utils';
import { SecretInput } from './SecretInput';
import { ProviderFields } from './ProviderFields';

/**
 * 服务商配置档案（多服务商支持）：
 * 不同厂商各建一个档案；同一厂商多个 key 填在同一档案内轮询。
 * 启动提取时可选档案（书库页弹窗），多本书并行时各用各的服务商。
 */

/** 思考模式选项（与后端枚举一一对应） */
const THINKING_OPTIONS = [
  { value: 'auto', label: '跟随模型默认', hint: '不发送思考参数' },
  { value: 'off', label: '关闭思考（省 Token）', hint: '混合推理模型生效；纯思考模型自动用默认档' },
  { value: 'low', label: '思考 · 低（快速）', hint: 'reasoning_effort=low' },
  { value: 'high', label: '思考 · 高', hint: 'reasoning_effort=high' },
  { value: 'max', label: '思考 · 最强', hint: 'reasoning_effort=max' },
] as const;

const THINKING_LABEL: Record<string, string> = Object.fromEntries(
  THINKING_OPTIONS.map((option) => [option.value, option.label]),
);

/** 编辑器状态：create 新建 / edit 编辑既有档案 */
type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; profileId: string }
  | null;

export function ProfilesSection() {
  const profilesQuery = useLlmProfiles();
  const { data: presetsData } = useLlmPresets();
  const createProfile = useCreateLlmProfile();
  const updateProfile = useUpdateLlmProfile();
  const deleteProfile = useDeleteLlmProfile();
  const activateProfile = useActivateLlmProfile();
  const testProfile = useTestLlmProfile();

  const presets = useMemo(() => presetsData?.presets ?? [], [presetsData]);
  const profiles = profilesQuery.data?.profiles ?? [];
  const canDelete = profiles.length > 1;

  // ── 编辑器状态 ──
  const [editor, setEditor] = useState<EditorState>(null);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [apiKeys, setApiKeys] = useState<string[]>(['']);
  const [thinking, setThinking] = useState<string>('auto');

  const activePreset = presets.find((p) => p.id === selectedProviderId);

  const resetEditor = () => {
    setEditor(null);
    setFormName('');
    setSelectedProviderId('');
    setSelectedModelId('');
    setUseCustom(false);
    setCustomBaseUrl('');
    setCustomModel('');
    setApiKeys(['']);
    setThinking('auto');
  };

  const startCreate = () => {
    resetEditor();
    setEditor({ mode: 'create' });
  };

  const startEdit = (profile: LlmProfileView) => {
    const match = matchPreset(presets, profile.baseUrl, profile.model);
    setEditor({ mode: 'edit', profileId: profile.id });
    setFormName(profile.name);
    if (match) {
      setSelectedProviderId(match.providerId);
      setSelectedModelId(match.modelId);
      setUseCustom(false);
      setCustomBaseUrl('');
      setCustomModel('');
    } else {
      setSelectedProviderId('');
      setSelectedModelId('');
      setUseCustom(true);
      setCustomBaseUrl(profile.baseUrl);
      setCustomModel(profile.model);
    }
    setApiKeys(['']);
    setThinking(profile.thinking || 'auto');
  };

  const onProviderSelect = (providerId: string) => {
    if (providerId === '__custom__') {
      setUseCustom(true);
      if (activePreset && !customBaseUrl) setCustomBaseUrl(activePreset.baseUrl);
    } else {
      setSelectedProviderId(providerId);
      setSelectedModelId('');
      setUseCustom(false);
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

  const save = async () => {
    if (!editor) return;
    if (!formName.trim()) {
      toast.error('请填写档案名称（如「Kimi 订阅」「DeepSeek」）');
      return;
    }
    const input: LlmProfileInput = {
      name: formName.trim(),
      thinking: thinking || 'auto',
    };
    if (useCustom) {
      // 自定义模式：手填值；编辑时空值表示保留原值
      if (customBaseUrl.trim()) input.baseUrl = customBaseUrl.trim();
      if (customModel.trim()) input.model = customModel.trim();
    } else if (activePreset) {
      input.baseUrl = activePreset.baseUrl;
      if (selectedModelId) input.model = selectedModelId;
    } else {
      toast.error('请选择服务商或切到自定义模式');
      return;
    }
    // 密钥：有输入才整体替换；全部留空 = 保留已保存密钥
    const newKeys = [...new Set(apiKeys.map((key) => key.trim()).filter(Boolean))];
    if (newKeys.length > 0) input.apiKeys = newKeys;

    setSaving(true);
    try {
      const res = editor.mode === 'create'
        ? await createProfile.mutateAsync(input)
        : await updateProfile.mutateAsync({ profileId: editor.profileId, input });
      if (res.warning) {
        toast.warning(res.warning, { duration: 10000 });
      } else {
        toast.success(editor.mode === 'create' ? '档案已创建，连接测试通过' : '档案已保存，连接测试通过');
      }
      resetEditor();
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (profile: LlmProfileView) => {
    try {
      const res = await testProfile.mutateAsync(profile.id);
      if (res.success) toast.success(`「${profile.name}」${res.message}`);
      else toast.error(`「${profile.name}」${res.message}`);
    } catch (e) {
      toast.error(`「${profile.name}」测试失败：${(e as Error).message}`);
    }
  };

  const activate = async (profile: LlmProfileView) => {
    try {
      await activateProfile.mutateAsync(profile.id);
      toast.success(`「${profile.name}」已设为默认档案`);
    } catch (e) {
      toast.error(`设置失败：${(e as Error).message}`);
    }
  };

  const remove = async (profile: LlmProfileView) => {
    if (!window.confirm(`确定删除档案「${profile.name}」？其密钥配置将被清除。`)) return;
    try {
      await deleteProfile.mutateAsync(profile.id);
      toast.success(`档案「${profile.name}」已删除`);
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    }
  };

  const editingProfile = editor?.mode === 'edit'
    ? profiles.find((p) => p.id === editor.profileId)
    : undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle>文本模型 · 服务商配置档案</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            不同服务商各建一个档案；同一服务商的多个密钥填在同一个档案内自动轮询。
            启动提取时可选用哪个档案，多本书可并行用不同服务商。
          </p>
        </div>
        <Button size="sm" onClick={startCreate} disabled={editor !== null}>
          <Plus className="mr-1 h-3.5 w-3.5" />新增档案
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {profilesQuery.isLoading && (
          <p className="text-sm text-muted-foreground">正在加载档案…</p>
        )}
        {profilesQuery.isError && (
          <p className="text-sm text-destructive">档案加载失败：{(profilesQuery.error as Error)?.message ?? '未知错误'}</p>
        )}

        {/* ── 编辑器（新建/编辑共用） ── */}
        {editor && (
          <div className="space-y-4 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{editor.mode === 'create' ? '新增配置档案' : `编辑「${editingProfile?.name ?? ''}」`}</p>
              <Button variant="ghost" size="sm" onClick={resetEditor}>取消</Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-name">档案名称</Label>
              <Input
                id="profile-name"
                name="profile-name"
                autoComplete="off"
                placeholder="如：Kimi 订阅、DeepSeek 备用"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <ProviderFields
              presets={presets}
              selectedProviderId={selectedProviderId}
              activePreset={activePreset}
              selectedModelId={selectedModelId}
              useCustom={useCustom}
              customBaseUrl={customBaseUrl}
              customModel={customModel}
              customModelPlaceholder="gpt-4o-mini"
              customBaseUrlHint="可填写 /v1 根地址或完整 /chat/completions 地址，后端会自动兼容多种填法。"
              baseUrlInputName="llm-profile-base-url"
              modelInputName="llm-profile-model"
              onProviderSelect={onProviderSelect}
              onModelChange={setSelectedModelId}
              onCustomBaseUrlChange={setCustomBaseUrl}
              onCustomModelChange={setCustomModel}
              showPresetBaseUrlHint
            />

            {/* 思考模式 */}
            <div className="space-y-1.5">
              <Label htmlFor="llm-profile-thinking">思考模式</Label>
              <Select value={thinking || 'auto'} onValueChange={setThinking}>
                <SelectTrigger id="llm-profile-thinking" aria-label="思考模式">
                  <SelectValue placeholder="跟随模型默认" />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                等级对应 reasoning_effort 参数；「关闭思考」仅对支持开关的混合推理模型生效。
              </p>
            </div>

            {/* API 密钥 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>API 密钥（同一服务商可多个）</Label>
                <Button type="button" variant="outline" size="sm" onClick={addKey}>
                  <Plus className="mr-1 h-3.5 w-3.5" />新增密钥
                </Button>
              </div>
              {editingProfile && editingProfile.keyHints.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {editingProfile.keyHints.map((hint, index) => (
                    <Badge key={`${hint}-${index}`} variant="secondary" className="font-mono">{hint}</Badge>
                  ))}
                </div>
              )}
              {apiKeys.map((key, index) => (
                <div key={index} className="flex items-center gap-2">
                  <SecretInput
                    name={`llm-profile-key-${index}`}
                    placeholder={editor.mode === 'edit' ? '输入新密钥可整体替换；留空保留已保存密钥' : 'sk-…'}
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
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editor.mode === 'create' ? '创建档案' : '保存修改'}
              </Button>
            </div>
          </div>
        )}

        {/* ── 档案列表 ── */}
        {profiles.map((profile) => {
          const match = matchPreset(presets, profile.baseUrl, profile.model);
          const presetLabel = match
            ? presets.find((p) => p.id === match.providerId)?.name
            : '自定义';
          return (
            <div
              key={profile.id}
              className={`space-y-2 rounded-md border p-3 ${profile.isActive ? 'border-primary/50 bg-primary/5' : ''}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{profile.name}</span>
                  {profile.isActive && (
                    <Badge variant="success" className="gap-1">
                      <BadgeCheck className="h-3 w-3" />默认
                    </Badge>
                  )}
                  <Badge variant="secondary">{presetLabel}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  {!profile.isActive && (
                    <Button
                      variant="outline" size="sm" className="h-7 px-2 text-xs"
                      disabled={activateProfile.isPending}
                      onClick={() => activate(profile)}
                    >
                      <Star className="mr-1 h-3 w-3" />设为默认
                    </Button>
                  )}
                  <Button
                    variant="outline" size="sm" className="h-7 px-2 text-xs"
                    disabled={testProfile.isPending && testProfile.variables === profile.id}
                    onClick={() => runTest(profile)}
                  >
                    {testProfile.isPending && testProfile.variables === profile.id
                      ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      : null}
                    测试
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-7 px-2 text-xs"
                    disabled={editor !== null}
                    onClick={() => startEdit(profile)}
                  >
                    <Pencil className="mr-1 h-3 w-3" />编辑
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    disabled={profile.isActive || !canDelete || deleteProfile.isPending}
                    title={profile.isActive ? '默认档案不可删除，请先把其他档案设为默认' : !canDelete ? '至少保留一个档案' : undefined}
                    onClick={() => remove(profile)}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />删除
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                <span>模型：<span className="text-foreground">{profile.model || '-'}</span></span>
                <span>密钥：<span className="text-foreground">{profile.keyCount} 个</span></span>
                <span>思考：<span className="text-foreground">{profile.thinking ? THINKING_LABEL[profile.thinking] ?? profile.thinking : '默认'}</span></span>
                <span className="truncate" title={profile.baseUrl}>地址：<span className="text-foreground">{profile.baseUrl || '-'}</span></span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
