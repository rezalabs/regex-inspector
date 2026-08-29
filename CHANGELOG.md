# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
-

### Changed
-

### Deprecated
-

### Removed
-

### Fixed

- **`fix()`:** keep input coercion inside the never-throws `try` block so an
  input whose `toString()` throws returns the documented fail-closed result
  instead of propagating the error.

### Security
-

## [1.1.0] - 2026-07-25

### Added

- **CLI:** stderr hints after an unsafe quick check pointing to `--analyze`
  and `--fix`; a stderr note when `--fix` output changes matching behavior;
  the analysis reasons on stderr when a pattern cannot be auto-fixed; a
  documented `--` separator for patterns that start with a dash.
- **CLI:** the quick check now prints the top diagnostic reason on stderr
  (in addition to the severity and hint), so an unsafe verdict is
  self-explanatory without a separate `--analyze` run; this also surfaces
  the "too complex to analyze" message for pathologically deep patterns.
- **CLI test suite** (`test/cli.test.ts`): covers exit codes, stdout/stderr
  stream discipline, argument validation, and error paths end to end.

### Changed

- **CLI:** `--analyze` now writes the JSON report to stdout and the
  human-readable summary to stderr, so the report can be piped directly into
  tools like `jq`.
- **CLI:** `--fix` prints the original pattern when it is already safe,
  making fix mode usable as a pass-through filter.
- **CLI:** usage errors print a short usage hint to stderr instead of the
  full help text to stdout; combining `--analyze` with `--fix` prints a note
  that `--fix` is ignored.
- **CLI:** the version is read from `package.json` only when `--version` is
  requested, and a read failure produces a clear error instead of a crash.

### Fixed

- **CLI:** `--analyze` now exits with code 1 for unsafe patterns, matching
  the documented exit code contract (it previously always exited 0).
- **CLI:** unknown options and unquoted dash-leading patterns no longer
  crash with a raw stack trace; a concise error with a `--` tip is printed.
- **CLI:** invalid regex patterns are reported as parse errors on stderr
  instead of being labeled unsafe with severity `high` on stdout.
- **CLI:** `--limit` rejects non-integer values such as `50abc`, `5.7`, and
  `0` instead of silently truncating them.
- **Docs:** corrected the quick-check severity for `(a+)+` in the README
  (`high`, not `critical`) and the `inspect()` parse-error `reasons` example
  in `docs/errors.md` to match the actual message text.
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

[Unreleased]: https://github.com/rezalabs/regex-inspector/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/rezalabs/regex-inspector/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/rezalabs/regex-inspector/releases/tag/v1.0.1
