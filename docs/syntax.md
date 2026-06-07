# Supported Syntax

All standard JavaScript regex syntax is fully supported, including modern
additions through ES2023.

## Literal Characters

Any character that is not a metacharacter is treated as a literal. The
following are metacharacters and must be escaped to be treated as literals:

```
\ [ { } ( ) ^ $ . | ? * +
```

## Character Classes `[...]`

| Pattern | Description |
|---------|-------------|
| `[abc]` | Matches any character in the set |
| `[^abc]` | Negated set: matches any character NOT in the set |
| `[a-z]` | Range from `a` to `z` |
| `[\w\d\s]` | Predefined sets inside classes |
| `[\p{L}]` | Unicode property escapes inside classes |
| `[\q{abc}]` | v-flag literal sequence expansion |
| `[-a]` | Dash at start: literal hyphen |
| `[a-]` | Dash at end: literal hyphen |
| `[]` | Empty set: matches nothing |
| `[^]` | Negated empty set: matches any character |
| `[a-z--[ab]]` | v-mode subtraction: characters in a-z but not in [ab] |
| `[a-z&&[ab]]` | v-mode intersection: characters in both a-z and [ab] |
| `[\q{abc\|def}]` | v-mode string literal: match "abc" or "def" as a unit |

## Predefined Character Sets

| Escape | Meaning | Equivalent |
|--------|---------|------------|
| `\d` | Digit | `[0-9]` |
| `\D` | Non-digit | `[^0-9]` |
| `\w` | Word character | `[_a-zA-Z0-9]` |
| `\W` | Non-word character | `[^_a-zA-Z0-9]` |
| `\s` | Whitespace | Tab, newline, space, etc. |
| `\S` | Non-whitespace | Everything else |
| `.` | Any character except line terminators | Negated line terminator set |

## Character Escapes

| Escape | Code Point |
|--------|------------|
| `\0` | 0 (null) |
| `\t` | 9 (tab) |
| `\n` | 10 (line feed) |
| `\v` | 11 (vertical tab) |
| `\f` | 12 (form feed) |
| `\r` | 13 (carriage return) |
| `\cX` | Control character (X in range @–?) |
| `\xHH` | 2-digit hex HH (0x00–0xFF) |
| `\uHHHH` | 4-digit hex (0x0000–0xFFFF) |
| `\u{H...}` | 1–6 digit hex in braces (0x0–0x10FFFF) |

## Unicode Property Escapes

| Pattern | Description |
|---------|-------------|
| `\p{L}` | Any character with property L (letter) |
| `\P{N}` | Any character NOT with property N (number) |
| `\p{Script=Latin}` | Characters in the Latin script |

## Quantifiers

| Quantifier | Min | Max | Description |
|------------|-----|-----|-------------|
| `*` | 0 | ∞ | Zero or more |
| `+` | 1 | ∞ | One or more |
| `?` | 0 | 1 | Optional |
| `{n}` | n | n | Exactly n |
| `{n,}` | n | ∞ | n or more |
| `{n,m}` | n | m | Between n and m |

All quantifiers support lazy mode with the `?` suffix: `*?`, `+?`, `??`, `{n,m}?`.

## Groups

| Pattern | Type |
|---------|------|
| `(...)` | Capturing group |
| `(?:...)` | Non-capturing group |
| `(?=...)` | Positive lookahead |
| `(?!...)` | Negative lookahead |
| `(?<=...)` | Positive lookbehind |
| `(?<!...)` | Negative lookbehind |
| `(?<name>...)` | Named capturing group |
| `(?ims-ims:...)` | Modifier group |
| `(?i)` | Standalone modifier |

Supported modifier flags: `i` (case-insensitive), `m` (multiline), `s` (dotAll),
and their negations with `-`.

## Assertions

| Pattern | Description |
|---------|-------------|
| `^` | Start of string (or line in multiline mode) |
| `$` | End of string (or line in multiline mode) |
| `\b` | Word boundary |
| `\B` | Non-word boundary |

## Backreferences

| Pattern | Description |
|---------|-------------|
| `\1`–`\9` | Numeric backreference to capturing group |
| `\k<name>` | Named backreference |

Numeric backreferences follow JavaScript semantics for octalescent
disambiguation: `\10` is a backreference to group 10 if 10 or more
groups exist; otherwise it falls back to octal interpretation.

## Disjunction

`|` separates alternatives. `/foo|bar/` matches either `foo` or `bar`.

## Octal Escapes

| Pattern | Value |
|---------|-------|
| `\0` | Null character |
| `\01`–`\377` | Octal value (1–255), following JavaScript octalescent rules |

## Unsupported

The following are outside the scope of this library:
- **Regex flags**: Flags (like `g`, `i`, `u`, `v`) are consumed by the
  `RegExp` constructor and are not part of the pattern string.
- **Unicode property expansion**: `\p{L}` stores the property name as a
  string; expanding it to actual character ranges requires embedding the
  entire Unicode character database.
- **Pattern matching**: This library parses and analyzes patterns; use
  `RegExp.prototype.exec()` and `.test()` for matching.
