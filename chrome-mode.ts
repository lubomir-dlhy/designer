/** Parses explicit DESIGNER_HEADLESS boolean values. */
export function designerHeadless(value = process.env.DESIGNER_HEADLESS): boolean {
  if (value == null || value === '' || value === '0' || value.toLowerCase() === 'false') return false;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  throw new Error(`Invalid DESIGNER_HEADLESS=${JSON.stringify(value)}; use 1/true or 0/false.`);
}

export function headlessChromeArgs(enabled = designerHeadless()): string[] {
  return enabled ? ['--headless=new'] : [];
}

// Default debug-browser window size. The design canvas is 1440 wide, so open big.
// Override with DESIGNER_WINDOW_SIZE=WxH (accepts WxH or W,H); =0/off to skip.
export function windowSizeArgs(value = process.env.DESIGNER_WINDOW_SIZE): string[] {
  const size = (value ?? '').trim() || '1920x1080';
  if (size === '0' || size.toLowerCase() === 'off') return [];
  const m = size.match(/^(\d{3,5})[x,](\d{3,5})$/i);
  if (!m) throw new Error(`Invalid DESIGNER_WINDOW_SIZE=${JSON.stringify(value)}; use WxH like 1920x1080.`);
  return [`--window-size=${m[1]},${m[2]}`];
}
