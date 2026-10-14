export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Relógio controlável para testes. */
export function fixedClock(
  initial: Date,
): Clock & { set(date: Date): void; advance(ms: number): void } {
  let current = new Date(initial);
  return {
    now: () => new Date(current),
    set: (date) => {
      current = new Date(date);
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}
