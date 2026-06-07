# API Reference

## `parse(pattern)` → `RootNode`

Tokenizes a regex string into a typed AST. Every character, group, quantifier,
assertion, and escape becomes an inspectable node.

```js
import { parse } from 'regex-inspector';

const ast = parse('\\d{3}-\\d{4}');
// RootNode with typed token tree
```

**Parameters:**
- `pattern` (`string`): The regex pattern string to parse (without delimiters or flags).

**Returns:** [`RootNode`](./ast.md#root)

**Throws:** `SyntaxError` if the pattern is invalid. See [Error Handling](./errors.md).

---

## `generate(node)` → `string`

Reconstructs a regex string from an AST node. The inverse of `parse()`.

```js
import { generate } from 'regex-inspector';

generate({ kind: 'char', value: 97 });
// → 'a'

const ast = parse('\\d{3}');
generate(ast);
// → '\\d{3}'
```

**Parameters:**
- `node` ([`Node`](./ast.md)): Any AST node (RootNode or Token).

**Returns:** `string`

**Throws:** `Error` if the node contains an unknown token kind or set member kind.

---

## `inspect(pattern, opts?)` → `AnalysisResult`

Parses a pattern and returns a full ReDoS analysis with severity level,
diagnostic data, and a suggested fix if unsafe.

Accepts strings, `RegExp` objects, or any value coercible to string.

```js
import { inspect } from 'regex-inspector';

const result = inspect('(a+)+y');
// {
//   safe: false,
//   severity: 'low',
//   reasons: ['Nested repetition detected (star height 2)'],
//   starHeight: 2,
//   repCount: 2,
//   hasAlternationReDoS: false,
//   hasSequentialOverlap: false,
//   anchored: false,
//   hasStaticSuffix: true,
//   fix: '(a+)y'
// }
```

**Parameters:**
- `pattern` (`string | RegExp | unknown`): The regex to analyze. `RegExp` objects
  are unwrapped via `.source`. Other values are coerced via `String()`.
- `opts?` ([`AnalyzeOptions`](#analyzeoptions))

**Returns:** [`AnalysisResult`](#analysisresult)

On parse errors, returns a structured result instead of throwing:

```js
inspect('[invalid');
// {
//   safe: false,
//   severity: 'high',
//   reasons: ['Invalid regex syntax: ...'],
//   starHeight: 0,
//   repCount: 0,
//   hasAlternationReDoS: false,
//   hasSequentialOverlap: false,
//   anchored: false,
//   hasStaticSuffix: false,
//   fix: null
// }
```

---

## `fix(pattern, opts?)` → `FixResult`

Attempts to produce a safe version of an unsafe regex.

```js
import { fix } from 'regex-inspector';

fix('(a+)+y');
// → { safe: true, fixed: '(a+)y', original: '(a+)+y', semanticChange: true }

fix('(a|aa|aaa)+');
// → { safe: true, fixed: 'a+', original: '(a|aa|aaa)+', semanticChange: true }

fix('^[a-z]+$');
// → { safe: true, fixed: null, original: '^[a-z]+$', semanticChange: false }
```

**Parameters:**
- `pattern` (`string | RegExp | unknown`): The regex to fix.
- `opts?` ([`FixOptions`](#fixoptions))

**Returns:** [`FixResult`](#fixresult)

**Fix strategies:**
1. **Strip redundant outer quantifiers.** `(a+)+` → `(a+)`. The inner
   quantifier already provides the repetition; the outer one only creates
   backtracking paths.
2. **Collapse same-character alternatives.** `(a|aa|aaa)+` → `a+`. When all
   alternatives are sequences of the same character, a single quantifier
   covers all of them.

Every suggested fix is verified to be safe before being returned. If no safe
fix can be generated, `fixed` is `null`.

---

## `analyze(ast, opts?)` → `AnalysisResult`

Analyzes an already-parsed AST node for ReDoS vulnerabilities. Same output
shape as `inspect()` but skips the parsing step.

```js
import { parse, analyze } from 'regex-inspector';

const ast = parse('(a+)+');
const result = analyze(ast);
```

**Parameters:**
- `ast` ([`Node`](./ast.md)): A parsed AST node.
- `opts?` ([`AnalyzeOptions`](#analyzeoptions))

**Returns:** [`AnalysisResult`](#analysisresult)

---

## `fixRegex(pattern, opts?)` → `FixResult`

Fixes an already-parsed AST node. Same output shape as `fix()` but accepts
an AST node or a string.

```js
import { parse, fixRegex } from 'regex-inspector';

const ast = parse('(a+)+');
const result = fixRegex(ast);
```

**Parameters:**
- `pattern` (`string | Node`): A regex string or parsed AST node.
- `opts?` ([`FixOptions`](#fixoptions))

**Returns:** [`FixResult`](#fixresult)

---

## Option Types

### `AnalyzeOptions`

```ts
type AnalyzeOptions = {
  /** Maximum allowed repetitions across the pattern (default: 25) */
  limit?: number;
};
```

### `FixOptions`

```ts
type FixOptions = {
  /** Maximum allowed repetitions (default: 25) */
  limit?: number;
};
```

---

## Return Types

### `AnalysisResult`

```ts
type AnalysisResult = {
  /** Whether the regex is safe from catastrophic backtracking */
  safe: boolean;
  /** Severity: 'none' | 'low' | 'high' | 'critical' */
  severity: Severity;
  /** Human-readable explanations of issues found */
  reasons: string[];
  /** Maximum nesting depth of quantifiers */
  starHeight: number;
  /** Total number of quantifiers in the pattern */
  repCount: number;
  /** Whether alternation prefix overlap was detected */
  hasAlternationReDoS: boolean;
  /** Whether consecutive overlapping quantifiers were detected */
  hasSequentialOverlap: boolean;
  /** Whether the pattern is anchored with ^...$ */
  anchored: boolean;
  /** Whether the pattern ends with a static suffix that preceding quantifiers cannot match */
  hasStaticSuffix: boolean;
  /** Auto-generated safe version, or null if not applicable */
  fix: string | null;
};
```

### `FixResult`

```ts
type FixResult = {
  /** Whether the regex is safe (the original if already safe, or the fixed version) */
  safe: boolean;
  /** The fixed regex string, or null if already safe or unfixable */
  fixed: string | null;
  /** The original regex string */
  original: string;
  /** Whether the fix changes the matching behavior */
  semanticChange: boolean;
};
```
