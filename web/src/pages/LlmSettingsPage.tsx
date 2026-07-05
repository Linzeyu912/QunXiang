import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useLlmStatus, useSetLlmConfig, useTestLlmConnection, type LlmConfigPatch } from '@/api/llm';

export function LlmSettingsPage() {
  const { data: status, isLoading } = useLlmStatus();
  const setConfig = useSetLlmConfig();
  const test = useTestLlmConnection();

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  // 密钥框显隐切换：默认隐藏，避免误展示；切换为 text 后可避免部分浏览器
  // 对 password 框强制自动填充已保存的账号密码（autofill 混淆的常见来源）。
  const [showKey, setShowKey] = useState(false);
  const [showExamples, setShowExamples] = useState(false);

  useEffect(() => {
    if (!status) return;
    setBaseUrl(status.baseUrl || '');
    setModel(status.model || '');
  }, [status]);

  const save = async () => {
    try {
      const patch: LlmConfigPatch = { provider: 'custom' };
      if (baseUrl.trim()) patch.baseUrl = baseUrl.trim();
      if (model.trim()) patch.model = model.trim();
      if (apiKey.trim()) patch.apiKey = apiKey.trim();
      await setConfig.mutateAsync(patch);
      toast.success('已保存配置');
      setApiKey('');
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
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
          <StatusRow label="API 密钥">{status?.keyHint || '未设置'}</StatusRow>
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
            <Label>API 密钥</Label>
            <div className="relative">
              {/* 用 text + 显隐切换替代原生 password，避免部分浏览器把已保存的
                  注册账号密码自动填充进这里（autofill 混淆）。type 仍随切换变化，
                  但 autoComplete 用 off 兜底。 */}
              <Input
                type={showKey ? 'text' : 'password'}
                name="llm-api-key"
                autoComplete="off"
                spellCheck={false}
                className="pr-9"
                placeholder={status?.keyHint ? `留空则保留当前值（${status.keyHint}）` : 'sk-xxx'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-7 w-7"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                title={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              留空保存则保留当前密钥不变。
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
