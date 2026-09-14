import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpenCheck, Layers, Server, Zap } from 'lucide-react';

/**
 * 多服务商与并行提取指南：把「配好多档案 → 每本书选档案 → 多本并行」的
 * 操作路径写清楚，用户不用猜怎么组合这些能力。
 */
export function ParallelGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>多服务商与并行提取指南</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <GuideStep
          icon={<Server className="h-4 w-4" />}
          title="第一步：把你要用的服务商各建一个档案"
          description="在上方「服务商配置档案」逐个新增：例如「Kimi 订阅」「DeepSeek」「智谱 GLM」各一个。同一服务商有多个密钥时，把这些密钥都填进同一个档案（自动轮询、失败自动摘除）；不同服务商必须分开建档案，因为接口地址和模型名互不通用。把常用的那个设为「默认」。"
        />
        <GuideStep
          icon={<BookOpenCheck className="h-4 w-4" />}
          title="第二步：提取某本书时选择档案"
          description="书库页点「开始提取」时，如果配置了多个档案，会弹出选择框让你指定这本书用哪个服务商（默认选中默认档案）。绑定后整个提取过程固定用该档案——中途改全局配置不影响进行中的书。"
        />
        <GuideStep
          icon={<Layers className="h-4 w-4" />}
          title="第三步：多本书并行"
          description="并发模式选「优先并行多本」时，工作进程数 = 所有档案的密钥总数（上限 8）。逐本书点「开始提取」、各自选好档案即可同时跑：例如 A 书用 Kimi、B 书用 DeepSeek，互不抢额度。每本书内部还会按密钥数自动控制批次并发，避免互相限流（429）。"
        />
        <GuideStep
          icon={<Zap className="h-4 w-4" />}
          title="只想快点跑完一本书？"
          description="并发模式切「优先单本速度」：工作进程收缩为 1，把该档案全部密钥的调用额度集中给这一本书。跑完再切回「优先并行多本」即可。"
        />
      </CardContent>
    </Card>
  );
}

function GuideStep({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="font-medium leading-none">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
