# regex-inspector

regex-inspector is a zero-dependency TypeScript library and CLI that parses any JavaScript regular expression into a typed AST, reconstructs it back to a string, analyzes it for catastrophic backtracking vulnerabilities, and fixes unsafe patterns automatically. Most regex testing tools only tell you whether a pattern matches your input. They do not tell you whether that pattern will explode when given a long non-matching string. regex-inspector performs static analysis of the regex structure itself, identifying patterns that force exponential backtracking: the root cause of ReDoS (regular expression denial of service) that has caused real outages at Cloudflare, Stack Overflow, and other major platforms.

## Features

- **Full regex-to-AST parsing:** Tokenizes any JavaScript regex pattern into a typed AST covering all standard syntax including named groups, lookbehinds, modifier groups, Unicode property escapes, v-flag `\q{...}` and set operations, and octalescent backreference disambiguation.
- **AST-to-string generation:** Round-trip reconstruction of regex strings from AST nodes with shorthand set normalization (`\d`, `\w`, `\s`, `.`).
- **ReDoS detection:** Static analysis for three classes of catastrophic backtracking: nested repetition (star height analysis), alternation prefix overlap, and sequential overlapping quantifiers (`.*?<head>.*?<title>.*?</title>` cascading O(N^k) backtracking without explicit nesting).
- **Severity scoring:** Four levels (`none`, `low`, `high`, `critical`) with automatic mitigation detection from anchoring (`^...$`) and exclusive static suffixes.
- **Auto-fix:** Strips redundant outer quantifiers (`(a+)+` to `(a+)`) and collapses same-character alternatives (`(a|aa|aaa)+` to `a+`). Every fix is verified safe before return.
- **CLI with exit codes:** Quick safety check (`npx regex-inspector '(a+)+'`), detailed JSON analysis (`-a`), and auto-fix output (`-f`) with configurable repetition limit.
- **Convenience API:** `inspect()` combines parse, analyze, and fix in a single call accepting strings, `RegExp` objects, and cross-realm-safe detection.
- **Zero dependencies:** Fully self-contained TypeScript implementation with no runtime dependencies.

### ReDoS Detection Details

**Nested repetition** (star height > 1): `(a+)+y`, `(x+x+)+y`; quantifiers inside quantifiers creating exponential backtracking paths. Automatically accounts for unambiguous inner structure where disjoint charsets make nested quantifiers safe (e.g., `(a+b+)+`).

**Alternation prefix overlap**: `(a|aa|aaa)+`, `(ab|abc)+`; alternatives inside a quantifier sharing a common prefix, allowing the engine to partition input in exponentially many ways. Extends to character classes (`[a-z]|[a-z][a-z]`), predefined sets (`\d|\d\d`), the dot metacharacter, and mixed CHAR/SET overlap.

**Sequential overlapping quantifiers**: `.*?<head>.*?<title>.*?</title>`, `. +?a.+?a.+?a`, or `(.*?,){11}P`; consecutive quantifiers whose match domains overlap with the token that follows them. Each quantifier can over-consume the delimiter, creating cascading O(N^k) backtracking when later tokens fail. A single adjacency inside a repeated group (e.g., `(.*?,){11}`) is similarly dangerous because the outer repetition amplifies the overlap.

### Severity Levels

| Level | Meaning |
|-------|---------|
| `none` | Safe |
| `low` | Minor issues or mitigated by anchoring/suffix |
| `high` | Nested repetition, alternation overlap, or sequential overlap |
| `critical` | Star height >= 3 |

Mitigating factors (`^...$` anchoring, trailing literal not matchable by preceding quantifiers) reduce severity. A trailing `y` after `(a+)+` helps because `a` cannot match `y`. A trailing `P` after `(.*?,){11}` does not help because dot also matches `P`.

## Quick Start

### Installation

```bash
npm install regex-inspector
```

### Basic Usage

```javascript
import { parse, generate, inspect, fix } from 'regex-inspector';

// Parse a regex into an AST
const ast = parse('(a+)+y');

// Reconstruct the pattern string from the AST
generate(ast);  // => '(a+)+y'

// Inspect for ReDoS vulnerabilities
inspect('(a+)+y');
// => { safe: false, severity: 'low', starHeight: 2, fix: '(a+)y', ... }

// Auto-fix unsafe patterns
fix('(a+)+');
// => { safe: false, fixed: '(a+)', original: '(a+)+', semanticChange: true }
```

```sh
# Quick safety check (exit code)
npx regex-inspector '(a+)+'           # => high (exit 1)
npx regex-inspector '^[a-z]+$'       # => safe (exit 0)

# Detailed analysis
npx regex-inspector -a '(x+x+)+y'

# Auto-fix output
npx regex-inspector -f '(x+x+)+y'    # => (x+x+)y

# Custom repetition limit
npx regex-inspector -l 50 '(a+)+'
```

For more complete scenarios, see the [CLI docs](./docs/cli.md) and [API reference](./docs/api.md).

## Configuration

regex-inspector works out of the box. The optional `limit` parameter controls the maximum allowed repetition depth:

```javascript
import { inspect } from 'regex-inspector';

const result = inspect('(a+)+', { limit: 50 });
```

## Security Advisory

If you maintain a service that accepts user-provided regex patterns (search fields, filtering tools, log analyzers), every regex you execute is a potential denial-of-service vector. An attacker who submits a long string against a vulnerable regex can pin a CPU core with a single HTTP request.

regex-inspector detects these patterns so you can reject, fix, or sandbox them before execution. It does not make them safe by itself.

## API Reference

Every public function is fully typed and has a corresponding set of unit tests.

| Function | Input | Output | Purpose |
|----------|-------|--------|---------|
| `parse` | `string` | `RootNode` | Tokenize regex into AST |
| `generate` | `Node` | `string` | Reconstruct regex from AST |
| `inspect` | `string \| RegExp` | `AnalysisResult` | Parse + analyze + suggest fix |
| `fix` | `string \| RegExp` | `FixResult` | Auto-fix unsafe patterns |
| `analyze` | `Node` | `AnalysisResult` | Analyze pre-parsed AST |
| `fixRegex` | `string \| Node` | `FixResult` | Fix pre-parsed AST |

The unit tests (in [`test/`](./test)) serve as the definitive, always-correct specification for edge behaviour.

Full details:

- **[`/docs` directory](./docs)** for detailed markdown references
- **[docs/api.md](./docs/api.md)** for the full API reference
- **[docs/ast.md](./docs/ast.md)** for AST node type documentation
- **[docs/cli.md](./docs/cli.md)** for CLI usage and options
- **[docs/syntax.md](./docs/syntax.md)** for supported regex syntax
- **[docs/errors.md](./docs/errors.md)** for error handling details

## Contributing

Pull requests are not accepted. This project is AI-assisted and single-maintainer; every line is curated through a consistent workflow that external PRs would disrupt.

What is accepted:

- **Bug reports** with reproduction steps.
- **Feature requests** that align with the project's core principles.
- **Documentation corrections** for errors or omissions.

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for details.

This project is maintained by [RezaLabs](https://rezalabs.com).

## Changelog

Notable changes between versions are documented in [`CHANGELOG.md`](./CHANGELOG.md). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## Development Process

This project is built with heavy assistance from large language models.

**Why?** The entire codebase, from architecture decisions down to individual line implementations, is produced through iterative prompting and review with AI. This is intentional. The goal is to test the limits of what AI can generate when held to strict quality standards.

**What this means for you:**
- Every commit and every release is reviewed and approved by a human. AI generates proposals; I accept, reject, or modify them.
- The project is a deliberate exercise in AI-assisted engineering. The output is curated, tested, and documented.
- If you find an issue, it is my failure as the maintainer to catch it, not an excuse that "the AI wrote it." I own all results.

This project is as much a product of AI capability as it is of human editorial judgment. You are welcome to judge both.

## Support

If this project saves you time or solves a problem you would otherwise pay to fix, consider supporting its continued development.

- [Buy Me a Coffee](https://buymeacoffee.com/rezalabs)
- [Ko-fi](https://ko-fi.com/rezalabs)

Sponsorship is never required, but always appreciated. It funds maintenance, tooling, and the compute needed to iterate with AI assistance at this scale.

## License

MIT License. See the full text in [`LICENSE`](./LICENSE).

Copyright (c) 2026 [RezaLabs](https://rezalabs.com)
