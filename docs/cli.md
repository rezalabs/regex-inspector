# CLI Reference

## Usage

```sh
regex-inspector [options] <regex>
```

Patterns that start with a dash must be preceded by `--` so they are not
parsed as options:

```sh
regex-inspector -- '-a+'
```

## Options

| Option | Short | Description |
|--------|-------|-------------|
| `--version` | `-v` | Display the version number |
| `--help` | `-h` | Display help message |
| `--analyze` | `-a` | Write a JSON analysis report to stdout and a human-readable summary to stderr |
| `--fix` | `-f` | Print the auto-fixed version; prints the original pattern when it is already safe |
| `--limit <n>` | `-l <n>` | Max repetitions (default: 25); must be a positive integer |

Combining `--analyze` with `--fix` runs the analysis (which already includes
the suggested fix) and prints a note to stderr that `--fix` is ignored.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Pattern is safe, or a fix was produced |
| `1` | Pattern is unsafe, invalid, or an error occurred |

All modes follow this contract, including `--analyze`.

## Output Streams

Verdicts and results go to stdout; diagnostics, hints, and notes go to stderr.
This keeps stdout stable for scripts:

- The quick check prints only `✓ safe` or `✗ <severity>` to stdout.
- `--analyze` prints only the JSON report to stdout, so it can be piped
  directly into tools like `jq`.
- `--fix` prints only a usable pattern to stdout (the fixed pattern, or the
  original when it is already safe), so fix mode works as a pass-through
  filter.

Invalid patterns are reported as parse errors on stderr (with nothing on
stdout), not as an "unsafe" verdict.

## Examples

### Quick safety check

```sh
regex-inspector '(a+)+'
# → ✗ high
# stderr: Nested repetition detected (star height 2)
# stderr: Hint: an auto-fix is available (--fix). Run with --analyze for the full report.
# exit: 1

regex-inspector '^[a-z]+$'
# → ✓ safe
# exit: 0
```

### Detailed analysis

```sh
regex-inspector -a '(x+x+)+y'
# stdout: full JSON report with severity, reasons, starHeight, fix suggestion, etc.
# stderr: human-readable summary
# exit: 1 (unsafe)

regex-inspector -a '(a+)+' | jq .severity
# → "high"
```

### Auto-fix output

```sh
regex-inspector -f '(x+x+)+y'
# → (x+x+)y
# stderr: Note: the fixed pattern does not match exactly the same strings as the original; review it before adopting.

regex-inspector -f '^[a-z]+$'
# → ^[a-z]+$
# stderr: Pattern is already safe; no fix needed.

regex-inspector -f '(ab|abc)+'
# stderr: Could not auto-fix this pattern, followed by the reasons it is unsafe
# exit: 1
```

### Custom limit

```sh
regex-inspector -l 50 '(a+)+'
```

## Notes

- The CLI requires the package to be built (`npm run build`) before first use.
- For development, use `tsx bin/regex-inspector.js` instead.
