import { DealsWorkspace } from './components/DealsWorkspace';
import { useViewState } from './hooks/useViewState';

/**
 * /deals route. The view (layout, filters, sort) lives in the URL via
 * useViewState; everything about working with deals is DealsWorkspace.
 */
export function DealsPage() {
  const { view, changeView } = useViewState();
  return <DealsWorkspace view={view} onViewChange={changeView} />;
}
