import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { TooltipProvider } from '@/shared/ui/tooltip';
import { createBackend } from '@mock-server/backend';
import { router } from '@/app/router/router';
import { SessionProvider } from '@/app/providers/SessionProvider';
import './app/styles/globals.css';
import { OWNERS } from '@/entities/deal';

// No real login: everyone is Priya, unless ?user=Rahul (open a second window as a teammate).
const fromUrl = new URLSearchParams(window.location.search).get('user');
const user = OWNERS.find((o) => o.toLowerCase() === fromUrl?.toLowerCase()) ?? 'Priya';
const session = crypto.randomUUID();
// The fake server. A real API would be `const api = new HttpApi(url)` and no `sim`.
const { api, sim } = createBackend();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider api={api} sim={sim} session={session} user={user}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </SessionProvider>
  </StrictMode>,
);
