import { NavLink } from 'react-router';
import { ServerCrash, Wifi, WifiOff, type LucideIcon } from 'lucide-react';
import type { Connection } from '@/features/deals';
import { ownerInitials } from '@/entities/deal';
import { InitialsAvatar } from '@/shared/ui/initials-avatar';
import { cn } from '@/shared/utils/cn';
import { NAV } from './nav';


const CONNECTION: Record<Connection, { label: string; icon: LucideIcon; className: string }> = {
  online: { label: 'Online', icon: Wifi, className: 'text-emerald-700 dark:text-emerald-400' },
  offline: { label: 'Offline', icon: WifiOff, className: 'text-amber-700 dark:text-amber-400' },
  unreachable: { label: 'Server unreachable', icon: ServerCrash, className: 'text-rose-700 dark:text-rose-400' },
};

/** App name, the pages, and who's signed in (with the connection status) at the bottom. */
export function Sidebar(props: { user: string; connection: Connection }) {
  const c = CONNECTION[props.connection];
  return (
    <nav aria-label="Main" className="flex w-52 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex h-11 shrink-0 items-center border-b px-5 text-sm font-semibold">Assignment</div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted', isActive && 'bg-muted font-medium')
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </div>
      <div className="flex items-center gap-2.5 border-t px-4 py-3" title={`Signed in as ${props.user}`}>
        <InitialsAvatar name={props.user} initials={ownerInitials(props.user)} highlight />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{props.user}</div>
          <div className={cn('flex items-center gap-1 text-xs', c.className)} aria-live="polite">
            <c.icon className="size-3.5" />{c.label}
          </div>
        </div>
      </div>
    </nav>
  );
}
