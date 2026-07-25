# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Library:** `inspect()` and `fix()` no longer mislabel or throw on
  syntactically valid but pathologically deep patterns that exceed the
  analyzer's recursion limit. They return a fail-closed result with a
  distinct "too complex to analyze" reason, and `fix()` now never throws,
  matching `inspect()`'s never-throw contract.

## [1.0.1] - 2026-06-07

### Added

- **Parser** (`parse`) -- Full tokenization of JavaScript regex patterns into
  typed ASTs. Supports all standard syntax including modern additions:
  named groups, lookbehinds, modifier groups, Unicode property escapes,
  v-flag `\q{...}`, and octalescent backreference disambiguation.
- **Generator** (`generate`) -- Round-trip reconstruction of regex strings
  from AST nodes. Shorthand set normalization (`\d`, `\w`, `\s`, `.`).
- **ReDoS Analyzer** (`analyze` / `inspect`) -- Detection of nested repetition
  (star height analysis), alternation prefix overlap, sequential
  overlapping quantifiers, and set member overlap including Unicode
  property escapes and nested character classes. Severity scoring with
  mitigation from anchoring and exclusive static suffix (a trailing `y`
  after `(a+)+` helps because `a` cannot match `y`; a trailing `P` after
  `(.*?,)` does not because dot also matches `P`). Unambiguous nested
  repetition detection for safe patterns like `(a+b+)+`.
- **Auto-fix** (`fix` / `fixRegex`) -- Strip redundant outer quantifiers
  (`(a+)+` to `(a+)`), collapse same-character alternatives (`(a|aa|aaa)+` to `a+`).
  Every fix is verified safe before return.
- **Convenience API** -- `inspect()` combines parse + analyze + fix in one
  call. Accepts strings, RegExp objects, and cross-realm-safe detection.
- **Preset exports** -- `digits()`, `wordChars()`, `whitespace()`,
  `lineTerminators()`, `dot()`, `negate()` for programmatic AST construction.
- **CLI** -- `regex-inspector` binary with quick check, detailed analysis,
  and auto-fix modes.
- **Zero dependencies** -- Fully self-contained TypeScript implementation.
- **405 tests** -- Full coverage of parser, generator, analyzer, fixer,
  convenience API, error paths, edge cases, and empirical V8 backtracking
  verification.

[Unreleased]: https://github.com/rezalabs/regex-inspector/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/rezalabs/regex-inspector/releases/tag/v1.0.1
