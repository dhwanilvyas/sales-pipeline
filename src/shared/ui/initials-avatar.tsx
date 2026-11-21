import { cn } from '@/shared/utils/cn';

/** "Priya" → "PR", "Priya Sharma" → "PS". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const s = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return s.toUpperCase();
}

/** A person as initials in a circle; the full name is in the tooltip and for screen readers. */
export function InitialsAvatar(props: { name: string; /** Override, e.g. initials made unique within a team. */ initials?: string; label?: string; highlight?: boolean; className?: string }) {
  const label = props.label ?? props.name;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
        props.highlight ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground ring-1 ring-border',
        props.className,
      )}
    >
      {props.initials ?? initials(props.name)}
    </span>
  );
}
