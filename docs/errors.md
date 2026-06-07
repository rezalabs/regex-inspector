# Error Handling

## Parse Errors

Invalid regex patterns produce a descriptive `SyntaxError` with the pattern and
position information.

| Error | Example | Cause |
|-------|---------|-------|
| Invalid group character after `?` | `(?_abc)` | Unrecognized character after `(?` |
| Nothing to repeat | `+`, `a++`, `a???` | Quantifier with nothing before it |
| Unmatched `)` | `hello)2u` | Closing paren without opening |
| Unterminated group | `(123` | Missing closing `)` |
| Unterminated character class | `[abc` | Missing closing `]` |
| Range out of order | `[z-a]` | Range start > end |
| Numbers out of order in quantifier | `a{5,3}` | Quantifier min > max |
| Invalid capture group name | `(?<1a>...)` | Name starts with digit |
| Duplicate capture group name | `(?<a>.)(?<a>.)` | Same name used twice |
| Unclosed capture group name | `(?<name!abc)` | Missing closing `>` |
| Invalid group name in backreference | `\k<nonexistent>` | `\k<name>` with no matching group |
| `\` at end of pattern | `foo\` | Backslash with nothing after |
| Invalid Unicode escape | `\u{110000}` | Code point > 0x10FFFF |
| Pattern too large | > 100,000 characters | Memory protection |

All parse errors are instances of `SyntaxError` with a descriptive message:

```
Invalid regular expression: /pattern/: Error message at column N
```

## API Error Handling

### `parse()`

Throws `SyntaxError` for invalid patterns. Catch with `try/catch`:

```js
import { parse } from 'regex-inspector';

try {
  const ast = parse('[invalid');
} catch (err) {
  console.error(err.message);
  // → "Invalid regular expression: /[invalid/: Unterminated character class"
}
```

### `inspect()` and `fix()`

Do **not** throw on invalid input. Instead, they return structured results:

```js
import { inspect } from 'regex-inspector';

inspect('[invalid');
// {
//   safe: false,
//   severity: 'high',
//   reasons: ['Invalid regex syntax: Unterminated character class'],
//   starHeight: 0,
//   repCount: 0,
//   hasAlternationReDoS: false,
//   hasSequentialOverlap: false,
//   anchored: false,
//   hasStaticSuffix: false,
//   fix: null
// }
```

```js
import { fix } from 'regex-inspector';

fix('[invalid');
// { safe: false, fixed: null, original: '[invalid', semanticChange: false }
```

### `generate()`

Throws `Error` if the AST contains unknown token or set member kinds. This
only happens with malformed ASTs constructed manually (not from `parse()`).
