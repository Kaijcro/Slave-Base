/** The town is drawn on a 520 x 320 "pixel" grid, then scaled up 3x so it stays crisp. */
export const W = 520;
export const H = 320;
export const S = 3;

/** Font used for signs and speech bubbles inside the game. */
export const PF = '"Pixelify Sans", ui-monospace, monospace';

/** Demo mode: game minutes that pass per real second at 1x speed (a full day takes 4 minutes). */
export const SIM_MINUTES_PER_SECOND = 6;

/**
 * How big the townsfolk are drawn, relative to the town art.
 * Use multiples of 1/3 (4/3, 5/3, 2) so every pixel stays a crisp square.
 */
export const PERSON_SCALE = 4 / 3;

/** Walking speed in town pixels per second. */
export const WALK_SPEED = 24;
