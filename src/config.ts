/**
 * The town is drawn on a 1040 x 640 pixel grid in isometric view (see src/iso/iso.ts),
 * then scaled up 2x on screen so it stays crisp.
 */
export const W = 1040;
export const H = 640;
export const S = 2;

/** Font used for signs and speech bubbles inside the game. */
export const PF = '"Pixelify Sans", ui-monospace, monospace';

/** Demo mode: game minutes that pass per real second at 1x speed (a full day takes 4 minutes). */
export const SIM_MINUTES_PER_SECOND = 6;

/** The day the demo starts on (0 = Sunday), so you see the church service soon after opening it. */
export const DEMO_START_DAY = 0;

/**
 * Sunday service. Everyone heads to church at `start` (minutes after midnight),
 * stays at least `minStay` minutes, and leaves once it is past `end`.
 */
export const CHURCH = { day: 0, start: 9 * 60 + 30, end: 11 * 60, minStay: 30 };

/** Walking speed in world units (sidewalk tiles) per second. */
export const WALK_SPEED = 2.4;

/**
 * How big the townsfolk are drawn. The people drawn in code (src/art/human.ts) are about 8 x 18 pixels,
 * so 2 makes them 16 x 36. If you swap in 16 x 36 sprite images, set this to 1.
 */
export const PERSON_SCALE = 2;
