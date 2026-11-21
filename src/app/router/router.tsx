import { Navigate, createBrowserRouter, useLocation } from 'react-router';
import { DealsPage } from '@/features/deals';
import { AppShell } from '@/app/layouts/AppShell';

/** Keep query params (e.g. ?user=) when redirecting to the default page. */
function ToDeals() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/deals', search }} replace />;
}


/** Add a page: a route here + an entry in layouts/nav.ts + src/features/<name>/. */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ToDeals /> },
      { path: 'deals', element: <DealsPage /> },
      { path: '*', element: <ToDeals /> },
    ],
  },
]);
