import assert from 'node:assert/strict';
import test from 'node:test';
import { jsLiteral } from '../js-literal.ts';

test('jsLiteral preserves values while escaping code and script boundaries', () => {
  const values = [
    'plain',
    'quote " and slash \\',
    '</script><script>alert(1)</script>',
    'line\u2028separator\u2029paragraph',
    ['selector</script>', 'a"b']
  ];
  for (const value of values) {
    const encoded = jsLiteral(value);
    assert.doesNotMatch(encoded, /[<>\u2028\u2029]/);
    assert.deepEqual(Function(`"use strict"; return (${encoded});`)(), value);
  }
});

test('jsLiteral refuses values JSON cannot represent', () => {
  assert.throws(() => jsLiteral(undefined), /not JSON-serializable/);
});
