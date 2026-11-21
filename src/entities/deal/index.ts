/**
 * Public API of the deal entity: what a deal IS and the business rules about it
 * (stages, priority, which deals a view shows, the server contract). No React,
 * no UI: any feature can use it, and so can the fake server.
 */
export * from './deal.types';
export * from './deal.priority';
export * from './deal.query';
export * from './deal.api';
