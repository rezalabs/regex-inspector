# AST Node Types

All nodes use a `kind` string discriminant for clear debugging and TypeScript
type narrowing. No numeric enums.

## `root`

Top-level node. Contains `branches`, one per `|` alternative. A linear pattern
(no alternation) has one branch.

```js
{ kind: 'root', branches: [ [token1, token2...] ] }
```

### Examples

```
/abc/        → { kind: 'root', branches: [[CHAR(97), CHAR(98), CHAR(99)]] }
/a|b/        → { kind: 'root', branches: [[CHAR(97)], [CHAR(98)]] }
```

---

## `group`

Parenthesized expressions. `capturing` distinguishes `(...)` from `(?:...)`.
Lookaround groups set one of `lookahead`, `negatedLookahead`, `lookbehind`,
`negatedLookbehind`. Named groups set `name`. Modifier groups set `modifiers`.

```js
// Capturing group
{ kind: 'group', capturing: true, branches: [ [token...] ] }

// Non-capturing group
{ kind: 'group', capturing: false, branches: [ [token...] ] }

// Positive lookahead
{ kind: 'group', capturing: false, lookahead: true, branches: [ [token...] ] }

// Negative lookahead
{ kind: 'group', capturing: false, negatedLookahead: true, branches: [ [token...] ] }

// Positive lookbehind
{ kind: 'group', capturing: false, lookbehind: true, branches: [ [token...] ] }

// Negative lookbehind
{ kind: 'group', capturing: false, negatedLookbehind: true, branches: [ [token...] ] }

// Named capturing group
{ kind: 'group', capturing: true, name: 'year', branches: [ [token...] ] }

// Modifier group
{ kind: 'group', capturing: false, modifiers: 'i', branches: [ [token...] ] }

// Standalone modifier
{ kind: 'group', capturing: false, modifiers: 'i', branches: [ [] ] }

// Empty group
{ kind: 'group', capturing: true, branches: [ [] ] }
```

Groups with alternation have multiple branches:

```js
// (a|b)
{ kind: 'group', capturing: true, branches: [ [CHAR(97)], [CHAR(98)] ] }
```

---

## `charset`

Character classes `[...]` or `[^...]`. `members` contains `char`, `range`,
`charset` (nested), or `unicode_property` tokens.

```js
{ kind: 'charset', negated: false, members: [member1, member2...] }
```

### Examples

```
[abc]       → { kind: 'charset', negated: false, members: [CHAR(97), CHAR(98), CHAR(99)] }
[^abc]      → { kind: 'charset', negated: true, members: [CHAR(97), CHAR(98), CHAR(99)] }
[a-z]       → { kind: 'charset', negated: false, members: [{ kind: 'range', from: 97, to: 122 }] }
[\w\d\s]    → { kind: 'charset', negated: false, members: [wordChars(), digits(), whitespace()] }
[\p{L}]     → { kind: 'charset', negated: false, members: [{ kind: 'unicode_property', property: 'L', negated: false }] }
[]          → { kind: 'charset', negated: false, members: [] }
```

Predefined shorthand sets (`\d`, `\w`, `\s`, `\D`, `\W`, `\S`) are expanded
into their equivalent charset nodes. The `generate()` function reconstructs
the shorthand form when possible.

The dot `.` is represented as a negated charset of line terminators:

```
.           → { kind: 'charset', negated: true, members: [CHAR(10), CHAR(13), CHAR(8232), CHAR(8233)] }
```

---

## `repetition`

Quantifiers: `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}`. `min` and `max` define the
range; `Infinity` means unbounded. `greedy` is `false` for lazy variants.

```js
{ kind: 'repetition', min: 0, max: Infinity, greedy: true, child: token }
```

### Examples

```
a*     → REPETITION { min: 0, max: Infinity, greedy: true, child: CHAR(97) }
a+     → REPETITION { min: 1, max: Infinity, greedy: true, child: CHAR(97) }
a?     → REPETITION { min: 0, max: 1, greedy: true, child: CHAR(97) }
a{3}   → REPETITION { min: 3, max: 3, greedy: true, child: CHAR(97) }
a{3,}  → REPETITION { min: 3, max: Infinity, greedy: true, child: CHAR(97) }
a{3,5} → REPETITION { min: 3, max: 5, greedy: true, child: CHAR(97) }
a+?    → REPETITION { min: 1, max: Infinity, greedy: false, child: CHAR(97) }
```

---

## `char`

A single literal character. `value` is the Unicode code point.

```js
{ kind: 'char', value: 97 }  // → 'a'
```

Supplementary plane characters (code points > 0xFFFF) are stored as the full
code point, not surrogate pairs, when parsed outside character classes. Inside
character classes, they are split into surrogate pair tokens for spec compliance.

---

## `position`

Anchors and boundaries: `^`, `$`, `\b`, `\B`.

```js
{ kind: 'position', value: '^' }
{ kind: 'position', value: '$' }
{ kind: 'position', value: 'b' }  // \b
{ kind: 'position', value: 'B' }  // \B
```

---

## `backreference`

Numeric or named backreference to a capturing group. `index` is the 1-based
group index, resolved from `\k<name>` during parsing.

```js
{ kind: 'backreference', index: 1 }
```

Numeric backreferences follow JavaScript semantics:
- `\1` with at least one capturing group → backreference
- `\1` with zero capturing groups → character (code point 1)
- `\10` with 10+ groups → backreference to group 10
- `\10` with less than 10 groups → octalescent fallback (octal 10 = 8)

---

## `unicode_property`

Unicode property escapes `\p{...}` or `\P{...}`. The property name is stored
as a string (e.g., `"L"`, `"Script=Latin"`); it is not expanded to character
ranges.

```js
{ kind: 'unicode_property', property: 'L', negated: false }    // \p{L}
{ kind: 'unicode_property', property: 'N', negated: true }      // \P{N}
{ kind: 'unicode_property', property: 'Script=Latin', negated: false }  // \p{Script=Latin}
```

---

## `range`

A character range inside a character class (`a-z`). Only appears as a member
of `charset.members`.

```js
{ kind: 'range', from: 97, to: 122 }  // a-z
```

---

## `string_member`

A v-mode string literal inside a character class (`\q{abc|def}`). The
`strings` array holds alternatives separated by `|`; each alternative is an
array of code points.

```js
{ kind: 'string_member', strings: [[97,98,99],[100,101,102]], negated: false }
// \q{abc|def}
```

---

## `set_op`

A v-mode set operation inside a character class. `operator` is `"subtract"`
for `--` or `"intersect"` for `&&`. Both `left` and `right` are `SetMember`
nodes (supporting arbitrary nesting).

```js
{ kind: 'set_op', operator: 'subtract', left: { kind: 'range', from: 97, to: 122 }, right: { kind: 'charset', negated: false, members: [{ kind: 'char', value: 97 }] } }
// [a-z--[a]]
```

---

## TypeScript Types

All types are exported from the package:

```ts
import type {
  Node,
  Token,
  RootNode,
  GroupNode,
  CharSetNode,
  RepetitionNode,
  CharNode,
  PositionNode,
  BackreferenceNode,
  UnicodePropertyNode,
  RangeMember,
  CharMember,
  StringMemberNode,
  SetOpNode,
  SetMember,
} from 'regex-inspector';
```
