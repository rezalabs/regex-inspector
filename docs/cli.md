# CLI Reference

## Usage

```sh
regex-inspector [options] <regex>
```

## Options

| Option | Short | Description |
|--------|-------|-------------|
| `--version` | `-v` | Display the version number |
| `--help` | `-h` | Display help message |
| `--analyze` | `-a` | Show detailed analysis report |
| `--fix` | `-f` | Print the auto-fixed version |
| `--limit <n>` | `-l <n>` | Max repetitions (default: 25) |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Pattern is safe |
| `1` | Pattern is unsafe, or an error occurred |

## Examples

### Quick safety check

```sh
regex-inspector '(a+)+'
# → ✗ high
# exit: 1

regex-inspector '^[a-z]+$'
# → ✓ safe
# exit: 0
```

### Detailed analysis

```sh
regex-inspector -a '(x+x+)+y'
# → Full JSON report with severity, reasons, starHeight, fix suggestion, etc.
```

### Auto-fix output

```sh
regex-inspector -f '(x+x+)+y'
# → (x+x+)y
```

### Custom limit

```sh
regex-inspector -l 50 '(a+)+'
```

## Notes

- The CLI requires the package to be built (`npm run build`) before first use.
- For development, use `tsx bin/regex-inspector.js` instead.
