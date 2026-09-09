/** Parses explicit DESIGNER_HEADLESS boolean values. */
export function designerHeadless(value = process.env.DESIGNER_HEADLESS): boolean {
  if (value == null || value === '' || value === '0' || value.toLowerCase() === 'false') return false;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  throw new Error(`Invalid DESIGNER_HEADLESS=${JSON.stringify(value)}; use 1/true or 0/false.`);
}

export function headlessChromeArgs(enabled = designerHeadless()): string[] {
  return enabled ? ['--headless=new'] : [];
}
