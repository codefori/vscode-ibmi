const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The colour picker has no empty state, so black is what it reports when no colour was ever picked. */
const NO_COLOR = `#000000`;

/**
 * Normalizes a status bar colour into `#rrggbb`; returns undefined when it's empty, invalid or black,
 * which leaves the status bar item with the colour of the current theme.
 */
export function parseStatusBarColor(color?: string) {
  const trimmed = (color || ``).trim();
  if (!HEX_COLOR.test(trimmed)) {
    return undefined;
  }

  const hex = trimmed.substring(1);
  const normalized = `#${hex.length === 3 ? hex.split(``).map(channel => channel + channel).join(``) : hex}`.toLowerCase();
  return normalized === NO_COLOR ? undefined : normalized;
}
