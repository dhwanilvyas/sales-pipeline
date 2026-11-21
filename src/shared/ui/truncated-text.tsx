import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

/** One line with an ellipsis; hovering shows the full text, but only when it's actually cut off. */
export function TruncatedText({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={(o) => setOpen(o && !!ref.current && ref.current.scrollWidth > ref.current.clientWidth)}>
      <TooltipTrigger asChild>
        <span ref={ref} className={cn('truncate', className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}
