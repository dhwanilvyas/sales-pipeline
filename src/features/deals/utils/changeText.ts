/**
 * Turn a change into a sentence about a deal or a group of deals:
 *   ("moved to Won", "Acme")             → "moved Acme to Won"
 *   ("moved to Lost", "40 of your deals") → "moved 40 of your deals to Lost"
 *   ("changed the value", "Acme")        → "changed the value of Acme"
 */
export function changeText(what: string, target: string): string {
  const m = what.match(/^(moved|reassigned) to (.+)$/);
  if (m) return `${m[1]} ${target} to ${m[2]}`;
  if (what === 'changed the value') return `changed the value of ${target}`;
  return `${what} on ${target}`;
}
