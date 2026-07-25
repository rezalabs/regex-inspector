#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USAGE = "Usage: regex-inspector [options] <regex>";

const HELP = `${USAGE}

Parse, inspect, and fix regular expressions: detect ReDoS vulnerabilities,
extract AST structure, or auto-fix unsafe patterns.

When called without options, performs a quick safety check and exits with a
status code (0 = safe, 1 = unsafe). Use --analyze for a full diagnostic report
or --fix to generate a safe alternative.

Exit codes:
  0  Pattern is safe (or a fix was produced)
  1  Pattern is unsafe, invalid, or an error occurred

Options:
  -v, --version          Display the version number
  -h, --help             Display this help message
  -a, --analyze          Write a JSON analysis report to stdout and a
                         human-readable summary to stderr
  -f, --fix              Output an auto-fixed safe version of the regex;
                         prints the original pattern when it is already safe
  -l, --limit <n>        Maximum allowed repetitions before flagging (default: 25)
  <regex>                The regular expression pattern to inspect

Examples:
  regex-inspector '(a+)+'                     Quick safety check (exit code indicates safe/unsafe)
  regex-inspector -a '(a+)+'                  Detailed analysis report
  regex-inspector -a '(a+)+' | jq .severity   Pipe the JSON report into jq
  regex-inspector -f '(x+x+)+y'               Auto-fix output
  regex-inspector -l 50 '(a+)+'               Custom repetition limit
  regex-inspector -- '-a+'                    Use -- before a pattern that starts with a dash`;

let opts;
let positionals;
try {
	({ values: opts, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			version: { type: "boolean", short: "v", default: false },
			help: { type: "boolean", short: "h", default: false },
			analyze: { type: "boolean", short: "a", default: false },
			fix: { type: "boolean", short: "f", default: false },
			limit: { type: "string", short: "l", default: undefined },
		},
	}));
} catch (err) {
	console.error(`Error: ${err.message}`);
	console.error(
		"Tip: quote the pattern, and put -- before a pattern that starts with a dash (regex-inspector -- '-a+').",
	);
	console.error("Run regex-inspector --help for usage.");
	process.exit(1);
}

if (opts.help) {
	console.log(HELP);
	process.exit(0);
}

if (opts.version) {
	try {
		const pkgPath = path.resolve(__dirname, "..", "package.json");
		const { version } = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		console.log(version);
		process.exit(0);
	} catch {
		console.error("regex-inspector: Unable to read version from package.json.");
		process.exit(1);
	}
}

if (positionals.length === 0) {
	console.error("Error: Missing regex argument.");
	console.error(USAGE);
	console.error("Run regex-inspector --help for details.");
	process.exit(1);
}

if (positionals.length > 1) {
	console.error(
		"Error: Too many positional arguments. Quote the pattern so the shell passes it as a single argument.",
	);
	console.error(USAGE);
	console.error("Run regex-inspector --help for details.");
	process.exit(1);
}

let limit;
if (opts.limit !== undefined) {
	if (!/^[1-9]\d*$/.test(opts.limit)) {
		console.error(
			`Error: --limit must be a positive integer (received "${opts.limit}").`,
		);
		process.exit(1);
	}
	limit = parseInt(opts.limit, 10);
}

let inspect, fix, parse;
try {
	const distPath = path.resolve(__dirname, "..", "dist", "index.js");
	const dist = await import(pathToFileURL(distPath).href);
	inspect = dist.inspect;
	fix = dist.fix ?? dist.fixRegex;
	parse = dist.parse;
} catch (_err) {
	console.error(
		'regex-inspector: Build not found at dist/index.js. Run "npm run build" first.',
	);
	process.exit(1);
}

const pattern = positionals[0];
const options = limit !== undefined ? { limit } : undefined;

// Distinguish invalid patterns from unsafe ones up front: a syntax error is a
// usage problem, not a ReDoS verdict, and should be reported as such.
try {
	parse(pattern);
} catch (err) {
	console.error(`Error: ${err.message}`);
	process.exit(1);
}

try {
	if (opts.analyze) {
		if (opts.fix) {
			console.error(
				"Note: --fix is ignored when combined with --analyze; the report already includes the suggested fix.",
			);
		}
		const result = inspect(pattern, options);
		if (result.safe) {
			console.error("✓ Pattern is safe.");
		} else {
			console.error(`✗ Pattern is unsafe (severity: ${result.severity}).`);
		}
		if (result.reasons.length > 0) {
			console.error("\nReasons:");
			for (const reason of result.reasons) {
				console.error(`  • ${reason}`);
			}
		}
		if (result.fix) {
			console.error(`\nSuggested fix: ${result.fix}`);
		}
		console.log(JSON.stringify(result, null, 2));
		process.exitCode = result.safe ? 0 : 1;
	} else if (opts.fix) {
		const result = fix(pattern, options);
		if (result.fixed) {
			console.log(result.fixed);
			if (result.semanticChange) {
				console.error(
					"Note: the fixed pattern does not match exactly the same strings as the original; review it before adopting.",
				);
			}
		} else if (result.safe) {
			console.log(pattern);
			console.error("Pattern is already safe; no fix needed.");
		} else {
			console.error("Could not auto-fix this pattern.");
			const analysis = inspect(pattern, options);
			for (const reason of analysis.reasons) {
				console.error(`  • ${reason}`);
			}
			console.error(
				"Rewrite it manually so quantified sub-expressions cannot match the same text; run with --analyze for the full report.",
			);
			process.exitCode = 1;
		}
	} else {
		const result = inspect(pattern, options);
		if (result.safe) {
			console.log("✓ safe");
		} else {
			console.log(`✗ ${result.severity}`);
			if (result.reasons.length > 0) {
				console.error(result.reasons[0]);
			}
			if (result.fix) {
				console.error(
					"Hint: an auto-fix is available (--fix). Run with --analyze for the full report.",
				);
			} else {
				console.error("Hint: run with --analyze for the full report.");
			}
			process.exitCode = 1;
		}
	}
} catch (err) {
	console.error("Error:", err.message);
	process.exitCode = 1;
}
