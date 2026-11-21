/**
 * Public API of the deals feature: the only things the rest of the app may use.
 * Everything else in this folder is private to the feature.
 */

// The page (route entry).
export { DealsPage } from './DealsPage';

// Sync engine: the app creates one client per tab and provides it.
export { PipelineClient, type Connection } from './api/pipelineClient';
export { DealClientProvider, useDealClient } from './api/DealClientProvider';
export { createLocalOutbox, type LocalOutbox } from './api/localOutbox';
export { LeftoverChanges } from './components/LeftoverChanges';
export { useSyncNotifications } from './hooks/useSyncNotifications';

// App-wide UI that must keep working whichever page is open.
export { ConnectionBanner } from './components/ConnectionBanner';
export { JobTray } from './components/JobTray';
export { JobsMenu } from './components/JobsMenu';
export { ShortcutHelp } from './components/ShortcutHelp';
