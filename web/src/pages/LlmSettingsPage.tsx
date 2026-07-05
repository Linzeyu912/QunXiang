import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useLlmStatus, useSetLlmConfig, useSetConcurrencyMode, useTestLlmConnection, type LlmConfigPatch } from '@/api/llm';
import type { ConcurrencyMode } from '@/types';

export function LlmSettingsPage() {
  const { data: status, isLoading } = useLlmStatus();
  const setConfig = useSetLlmConfig();
  const setMode = useSetConcurrencyMode();
  const test = useTestLlmConnection();

  // 多 key 编辑：初始留一个空行让用户填新 key；已保存的 key 用 mask 占位（不回显明文）。
  // 编辑语义：用户填入的非空 key 会和"已保存且未改动"的 key 合并后整体提交。
  const [apiKeys, setApiKeys] = useState<string[]>(['']);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showExamples, setShowExamples] = useState(false);

  // 后端 keyHints 表示已保存的 key。初始化编辑区：若已有 key，展示 mask 行 + 一个空行；
  // 否则只留一个空行。
  useEffect(() => {
    if (!status) return;
    setBaseUrl(status.baseUrl || '');
    setModel(status.model || '');
    const saved = status.keyHints && status.keyHints.length > 0 ? status.keyHints : [];
    if (saved.length > 0) {
      // 用占位符代表"已保存的 key 不变"：空字符串输入框 + 旁注 mask
      setApiKeys(['']);
    }
  }, [status]);

  const updateKey = (i: number, v: string) => {
    setApiKeys((prev) => prev.map((k, idx) => (idx === i ? v : k)));
  };
  const addKey = () => setApiKeys((prev) => [...prev, '']);
  const removeKey = (i: number) => setApiKeys((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    try {
      const patch: LlmConfigPatch = { provider: 'custom' };
      if (baseUrl.trim()) patch.baseUrl = baseUrl.trim();
      if (model.trim()) patch.model = model.trim();
      // 收集用户填入的非空 key（trim），去重
      const newKeys = apiKeys
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      const deduped = [...new Set(newKeys)];
      if (deduped.length > 0) {
        patch.apiKeys = deduped;
      }
      await setConfig.mutateAsync(patch);
      toast.success('已保存配置');
      // 保存后清空编辑区，已保存的 key 由 status.keyHints 反映
      setApiKeys(['']);
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  };

  const switchMode = async (mode: ConcurrencyMode) => {
    try {
      await setMode.mutateAsync(mode);
      toast.success(mode === 'parallel-books' ? '已切换为：优先并行本数' : '已切换为：优先单本速度');
    } catch (e) {
      toast.error(`切换失败：${(e as Error).message}`);
    }
  };

  const runTest = async () => {
    try {
      const res = await test.mutateAsync();
      if (res.success) {
        toast.success(res.message);
      } else {
        // 失败时把原始报错片段一并展示，方便用户判断是 base url / key / 模型名
        // / 网络 / 超时中的哪一项问题。detail 可能较长，sonner 支持多行 description。
        toast.error(res.message, {
          description: res.detail ? `原始信息：${res.detail}` : undefined,
          duration: 8000,
        });
      }
    } catch (e) {
      toast.error(`测试失败：${(e as Error).message}`);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">LLM 服务商设置</h1>
        <p className="text-sm text-muted-foreground">配置提取管道使用的语言模型</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle>当前状态</CardTitle>
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
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <StatusRow label="服务商">{status?.provider ?? '-'}</StatusRow>
          <StatusRow label="模型">{status?.model || '-'}</StatusRow>
          <StatusRow label="接口地址">{status?.baseUrl || '-'}</StatusRow>
          <StatusRow label="API 密钥">
            {status?.keyCount && status.keyCount > 0
              ? `${status.keyCount} 个密钥（${status.keyHints?.join(' / ') || status.keyHint}）`
              : (status?.keyHint || '未设置')}
          </StatusRow>
          {status?.concurrency && (
            <StatusRow label="并发模式">
              {status.concurrency.mode === 'parallel-books' ? '优先并行本数' : '优先单本速度'}
              （{status.concurrency.workers} worker）
            </StatusRow>
          )}
          {status?.error && (
            <p className="col-span-2 text-xs text-destructive">{status.error}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>修改配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-medium">自定义 API</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              使用兼容 OpenAI Chat Completions 协议的 LLM 接口。
            </p>
          </div>

          {/* 常见服务商填写示例：折叠展开。重点解决 minimax 等国产 OpenAI 兼容
              服务因 base url / 模型名填错导致调用失败的问题。点击行可一键回填。 */}
          <div className="rounded-md border">
            <button
              type="button"
              onClick={() => setShowExamples((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent/40"
            >
              <span>常见服务商填写示例（minimax / DeepSeek / OpenAI）</span>
              {showExamples ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showExamples && (
              <div className="space-y-2 border-t px-3 py-2 text-xs text-muted-foreground">
                <ProviderExample
                  title="MiniMax（国内）"
                  baseUrl="https://api.minimaxi.com/v1"
                  model="MiniMax-M2"
                  onApply={(b, m) => { setBaseUrl(b); setModel(m); }}
                />
                <ProviderExample
                  title="MiniMax（国际）"
                  baseUrl="https://api.minimax.io/v1"
                  model="MiniMax-M2"
                  onApply={(b, m) => { setBaseUrl(b); setModel(m); }}
                />
                <ProviderExample
                  title="DeepSeek"
                  baseUrl="https://api.deepseek.com/v1"
                  model="deepseek-chat"
                  onApply={(b, m) => { setBaseUrl(b); setModel(m); }}
                />
                <ProviderExample
                  title="OpenAI"
                  baseUrl="https://api.openai.com/v1"
                  model="gpt-4o-mini"
                  onApply={(b, m) => { setBaseUrl(b); setModel(m); }}
                />
                <p className="pt-1">
                  提示：接口地址填到 <code className="rounded bg-muted px-1">/v1</code> 即可，后端会自动补全
                  <code className="rounded bg-muted px-1">/chat/completions</code>；注意 minimax 国内站与国际站的密钥不通用。
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>接口地址</Label>
            <Input
              name="llm-base-url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              填到 /v1 根地址或完整 /chat/completions 地址均可，后端自动兼容。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>模型名称</Label>
            <Input
              name="llm-model"
              autoComplete="off"
              spellCheck={false}
              placeholder="gpt-4o-mini"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>API 密钥</Label>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={addKey}>
                <Plus className="mr-1 h-3 w-3" />
                添加密钥
              </Button>
            </div>
            {/* 已保存的 key 以 mask 展示（只读），下方是用户可填/可增删的新 key 输入框。
                多 key 同厂家轮询，把单 key 的 ~10 路并发额度提升到 N×10。 */}
            {status?.keyHints && status.keyHints.length > 0 && (
              <div className="space-y-1">
                {status.keyHints.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground"
                  >
                    <span className="font-mono">{h}</span>
                    <Badge variant="outline" className="ml-auto">已保存</Badge>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              {apiKeys.map((k, i) => (
                <div key={i} className="relative">
                  {/* text + 显隐切换，规避浏览器对 password 框的 autofill */}
                  <Input
                    type={showKey ? 'text' : 'password'}
                    name={`llm-api-key-${i}`}
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-16"
                    placeholder="填入新密钥（留空不添加）"
                    value={k}
                    onChange={(e) => updateKey(i, e.target.value)}
                  />
                  <div className="absolute right-1 top-1 flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                      title={showKey ? '隐藏' : '显示'}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    {apiKeys.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeKey(i)}
                        aria-label="删除此密钥输入框"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              支持同厂家多个密钥，后端会自动轮询以提升并发额度。保存后已添加的密钥会显示为掩码。
            </p>
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

      {/* 并发模式选择：让用户在「并行多本」和「单本速度」之间取舍。
          - parallel-books：worker 数 = key 数，多本并行
          - single-book-speed：单 worker，全部额度给当前一本 */}
      <Card>
        <CardHeader>
          <CardTitle>并发模式</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            根据「密钥数」与「使用场景」选择。每个密钥通常对应约 10 路并发额度。
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ModeOption
              active={status?.concurrency?.mode === 'parallel-books'}
              disabled={setMode.isPending}
              onClick={() => switchMode('parallel-books')}
              title="优先并行本数"
              desc={`worker 数 = 密钥数，多本书可同时提取${status?.concurrency ? `（当前 ${status.concurrency.workers} 个 worker）` : ''}`}
            />
            <ModeOption
              active={status?.concurrency?.mode === 'single-book-speed'}
              disabled={setMode.isPending}
              onClick={() => switchMode('single-book-speed')}
              title="优先单本速度"
              desc="单 worker，把全部并发额度集中给当前这一本（同时只能处理 1 本）"
            />
          </div>
          {status?.concurrency && (
            <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
              {status.concurrency.keyCount > 0
                ? `检测到 ${status.concurrency.keyCount} 个密钥。建议「优先并行本数」模式，可同时提取约 ${status.concurrency.recommended} 本。`
                : '尚未配置密钥。配置后可按密钥数自动并行多本。'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
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

/** 并发模式选项卡片。 */
function ModeOption({
  active,
  disabled,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        'flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors disabled:opacity-50 ' +
        (active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent/40')
      }
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </button>
  );
}

/** 服务商示例条目：展示标题 + base url + 模型名，点「填入」一键回填到表单。 */
function ProviderExample({
  title,
  baseUrl,
  model,
  onApply,
}: {
  title: string;
  baseUrl: string;
  model: string;
  onApply: (baseUrl: string, model: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="truncate font-mono text-[11px]">{baseUrl} · {model}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        onClick={() => onApply(baseUrl, model)}
      >
        填入
      </Button>
    </div>
  );
}
