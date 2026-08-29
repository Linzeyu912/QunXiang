/* eslint-disable react-refresh/only-export-components -- shadcn 生成文件，导出 variants 供其他模块组合样式，是社区惯例 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        // 语义状态一律取自设计令牌（index.css），不在组件里散落具体色板
        success: 'border-success/20 bg-success/10 text-success',
        warning: 'border-warning/20 bg-warning/10 text-warning',
        info: 'border-info/20 bg-info/10 text-info',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  // 用 <span> 而非 <div>：Badge 常出现在 <button>（实体/故事列表行）内部，
  // HTML 规范禁止 div 嵌套在 button 内，浏览器会强制重排导致样式/事件错位。
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
