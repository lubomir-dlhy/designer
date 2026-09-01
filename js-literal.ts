// Serialize data for interpolation into JavaScript source evaluated in the
// browser. JSON.stringify alone leaves characters that can terminate a script
// element or form JavaScript line separators. Keep this boundary centralized
// so every dynamic browser expression uses the same context-specific escaping.
export function jsLiteral(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('value is not JSON-serializable');
  return json.replace(/[<>\u2028\u2029]/g, (char) => {
    switch (char) {
      case '<': return '\\u003C';
      case '>': return '\\u003E';
      case '\u2028': return '\\u2028';
      case '\u2029': return '\\u2029';
      default: throw new TypeError('unexpected unsafe JavaScript character');
    }
  });
}
