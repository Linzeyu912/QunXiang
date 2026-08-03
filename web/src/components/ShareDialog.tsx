import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { useCreateShare } from '@/api/shares';

/**
 * 分享对话框：输入接收方邮箱 + 账号分享码（接收方在账号页查看/轮换）。
 * 邮箱与分享码必须指向同一账号；服务端双重校验，失败统一中文提示。
 */
export function ShareDialog({
  bookId,
  bookTitle,
  open,
  onOpenChange,
}: {
  bookId: string;
  bookTitle: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useCreateShare(bookId);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const submit = async () => {
    try {
      await create.mutateAsync({ recipientEmail: email, recipientShareCode: code });
      toast.success(`已分享《${bookTitle}》`);
      setEmail('');
      setCode('');
      onOpenChange(false);
    } catch (e) {
      toast.error(`分享失败：${(e as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>分享《{bookTitle}》</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            输入接收方邮箱与其账号分享码（接收方在「账号」页查看）。邮箱与分享码必须指向同一账号。
          </p>
          <div className="space-y-1">
            <Label htmlFor="rcpt-email">接收方邮箱</Label>
            <Input
              id="rcpt-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rcpt-code">接收方分享码</Label>
            <Input
              id="rcpt-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="接收方的账号分享码"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button onClick={submit} disabled={create.isPending || !email || !code}>
            确认分享
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
