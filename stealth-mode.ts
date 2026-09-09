// Anti-detection launch flags for the debug Chrome, applied natively (no Docker,
// no custom engine). designer already drives a real Chrome build headful on a
// dedicated signed-in profile; these flags remove the residual automation tells
// a site can read (chiefly the Blink "AutomationControlled" feature that flips
// navigator.webdriver and related surfaces).
//
// Deliberately minimal and non-fingerprinting: real Chrome already presents a
// genuine fingerprint, so — following the patchright approach — we only strip
// the automation markers rather than spoofing canvas/WebGL/UA. Fingerprint-level
// stealth is a separate, heavier engine (Fortress); see README.
//
// NOTE: the session lives in the profile encrypted with the launching browser's
// OS keystore key. Opening the same --user-data-dir with a *different* Chrome
// build re-writes that store and invalidates the login, so pin CHROME_BIN to one
// build for the designer profile.

/** Parses the DESIGNER_STEALTH opt-out. Stealth is ON by default. */
export function stealthEnabled(value = process.env.DESIGNER_STEALTH): boolean {
  if (value == null || value === '') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  throw new Error(`Invalid DESIGNER_STEALTH=${JSON.stringify(value)}; use 1/true or 0/false.`);
}

// Chrome flags that strip automation tells. `AutomationControlled` is the Blink
// feature behind navigator.webdriver; disabling it keeps webdriver false and
// avoids the automation-controlled surface even if a caller ever adds
// --enable-automation upstream. Cookie-safe: touches no profile state.
export function stealthChromeArgs(enabled = stealthEnabled()): string[] {
  return enabled ? ['--disable-blink-features=AutomationControlled'] : [];
}
