import { Card, CardContent } from '@/components/ui/card';

/**
 * 「需要代理？」折叠帮助：说明国内访问 / 中转服务场景下 Base URL 的填法。
 * 填法规则与后端 normalizeApiUrl（llm/src/providers/custom.ts）保持一致。
 */
export function BaseUrlHelp() {
  return (
    <Card>
      <CardContent className="pt-6">
        <details className="group">
          <summary className="cursor-pointer list-none select-none text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            需要代理 / 中转服务？查看接口地址填法说明
          </summary>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p>
              国内直连不稳定时，可以使用 OpenAI 兼容的中转 / 代理服务：切换到「自定义」模式，
              把中转服务提供的<strong className="text-foreground">接口地址填到 Base URL</strong>
              ，密钥填中转服务发放的 key（不是官方 key）。
            </p>
            <p>Base URL 以下两种填法都可以：</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                填到版本号结尾（推荐），例如
                <code className="rounded bg-muted px-1 py-0.5 text-xs">https://your-proxy.example.com/v1</code>
                ，系统会自动补全 <code className="rounded bg-muted px-1 py-0.5 text-xs">/chat/completions</code>；
              </li>
              <li>
                或直接填完整端点，例如
                <code className="rounded bg-muted px-1 py-0.5 text-xs">https://your-proxy.example.com/v1/chat/completions</code>。
              </li>
            </ul>
            <p>
              只填裸域名也会按 OpenAI 标准自动补
              <code className="rounded bg-muted px-1 py-0.5 text-xs">/v1/…</code>；
              若服务商路径不含 /v1（例如
              <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/paas/v4</code>），请填到版本号结尾。
            </p>
            <p>
              保存后点「测试连接」验证。若返回 404，多半是地址末段不是版本号（如
              <code className="rounded bg-muted px-1 py-0.5 text-xs">/v1</code>），请求打到了服务商网关——对照上面两种填法检查即可。
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
