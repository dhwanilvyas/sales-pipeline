import { DAY, OWNERS, isOpen, type Deal, type Stage } from '@/entities/deal';

/** Small deterministic PRNG so every load (and every test) sees the same data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFIX = [
  'Acme', 'Globex', 'Initech', 'Umbrella', 'Stark', 'Wayne', 'Wonka', 'Tyrell', 'Soylent', 'Hooli',
  'Pied Piper', 'Vandelay', 'Cyberdyne', 'Massive', 'Aperture', 'Oscorp', 'Gringotts', 'Monarch', 'Nakatomi', 'Zenith',
  'Bluefin', 'Saffron', 'Indus', 'Kaveri', 'Himalaya', 'Lotus', 'Peacock', 'Banyan', 'Monsoon', 'Deccan',
  'Coral', 'Quartz', 'Nimbus', 'Vertex', 'Orbit', 'Pinnacle', 'Harbor', 'Summit', 'Crescent', 'Falcon',
];
const SUFFIX = [
  'Corp', 'Labs', 'Systems', 'Retail', 'Logistics', 'Health', 'Fintech', 'Foods', 'Motors', 'Energy',
  'Textiles', 'Pharma', 'Media', 'Infra', 'Telecom', 'Analytics', 'Insurance', 'Education', 'Travel', 'Realty',
];

// Rough real-world shape: lots of early-stage and lost deals, ~10k in the biggest stages.
const STAGE_WEIGHTS: [Stage, number][] = [
  ['new', 10_000], ['contacted', 9_000], ['demo', 7_000], ['proposal', 5_500],
  ['negotiation', 4_000], ['won', 4_500], ['lost', 10_000],
];

function pickWeighted<T>(r: number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [item, w] of items) {
    if ((x -= w) < 0) return item;
  }
  return items[items.length - 1][0];
}

export function generateDeals(count: number, now: number, seed = 42): Deal[] {
  const rand = mulberry32(seed);
  const int = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));
  const deals: Deal[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const stage = pickWeighted(rand(), STAGE_WEIGHTS);
    const open = isOpen(stage);
    const licences = int(5, 500);
    const value = licences * int(4, 40) * 1000;
    // Activity skews recent, with a long tail of neglected deals (quarter-end cleanup).
    const idleDays = Math.floor(Math.pow(rand(), 2.2) * 300);
    const lastActivityAt = now - idleDays * DAY - int(0, 8) * 3_600_000;
    const nextStepAt = open && rand() < 0.75 ? now + int(-12, 40) * DAY : null;
    const expectedCloseAt = now + int(-40, 150) * DAY;
    const updatedToday = rand() < 0.015;
    const updatedAt = updatedToday ? now - int(0, 6) * 3_600_000 : lastActivityAt;
    const owner = OWNERS[int(0, OWNERS.length - 1)];
    deals[i] = {
      id: `D-${String(i + 1).padStart(5, '0')}`,
      name: `${PREFIX[int(0, PREFIX.length - 1)]} ${SUFFIX[int(0, SUFFIX.length - 1)]}`,
      licences,
      value,
      owner,
      stage,
      nextStepAt,
      expectedCloseAt,
      lastActivityAt,
      stageChangedAt: lastActivityAt,
      stageChangedBy: owner,
      updatedAt,
      updatedBy: OWNERS[int(0, OWNERS.length - 1)],
      updatedBySession: 'seed',
      version: 1,
      seq: 0,
    };
  }
  return deals;
}
