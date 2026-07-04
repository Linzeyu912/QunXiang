import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
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
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
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

          <div className="space-y-1.5">
            <Label>接口地址</Label>
            <Input
              name="llm-base-url"
              autoComplete="off"
              placeholder="https://api.openai.com/v1/chat/completions"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
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
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>API 密钥</Label>
            <Input
              type="password"
              name="llm-api-key"
              autoComplete="off"
              placeholder={status?.keyHint ? `留空则保留当前值（${status.keyHint}）` : 'sk-xxx'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
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
