const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Normalizes a user entered status bar colour into `#rrggbb`; returns undefined when it's empty or
 * invalid, which leaves the status bar item with the colour of the current theme.
 */
export function parseStatusBarColor(color?: string) {
  const trimmed = (color || ``).trim();
  if (!HEX_COLOR.test(trimmed)) {
    return undefined;
  }

  const hex = trimmed.substring(1);
  return `#${hex.length === 3 ? hex.split(``).map(channel => channel + channel).join(``) : hex}`.toLowerCase();
}
