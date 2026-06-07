#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, "..", "package.json");
const { version } = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		version: { type: "boolean", short: "v", default: false },
		help: { type: "boolean", short: "h", default: false },
		analyze: { type: "boolean", short: "a", default: false },
		fix: { type: "boolean", short: "f", default: false },
		limit: { type: "string", short: "l", default: undefined },
	},
});

const HELP = `Usage: regex-inspector [options] <regex>

Parse, inspect, and fix regular expressions: detect ReDoS vulnerabilities,
extract AST structure, or auto-fix unsafe patterns.

When called without options, performs a quick safety check and exits with a
status code (0 = safe, 1 = unsafe). Use --analyze for a full diagnostic report
or --fix to generate a safe alternative.

Exit codes:
  0  Pattern is safe
  1  Pattern is unsafe, or an error occurred

Options:
  -v, --version          Display the version number
  -h, --help             Display this help message
  -a, --analyze          Show detailed analysis with severity, reasons, and suggested fix
  -f, --fix              Output an auto-fixed safe version of the regex
  -l, --limit <n>        Maximum allowed repetitions before flagging (default: 25)
  <regex>                The regular expression pattern to inspect

Examples:
  regex-inspector '(a+)+'            Quick safety check (exit code indicates safe/unsafe)
  regex-inspector -a '(a+)+'         Detailed analysis report
  regex-inspector -f '(x+x+)+y'      Auto-fix output
  regex-inspector -l 50 '(a+)+'      Custom repetition limit`;

if (opts.help) {
	console.log(HELP);
	process.exit(0);
}

if (opts.version) {
	console.log(version);
	process.exit(0);
}

if (positionals.length === 0) {
	console.error("Error: Missing regex argument.");
	console.log(HELP);
	process.exit(1);
}

if (positionals.length > 1) {
	console.error("Error: Too many positional arguments.");
	console.log(HELP);
	process.exit(1);
}

let inspect, fix;
try {
	const distPath = path.resolve(__dirname, "..", "dist", "index.js");
	const dist = await import(pathToFileURL(distPath).href);
	inspect = dist.inspect;
	fix = dist.fix ?? dist.fixRegex;
} catch (_err) {
	console.error(
		'regex-inspector: Build not found at dist/index.js. Run "npm run build" first.',
	);
	process.exit(1);
}

const pattern = positionals[0];
const limit = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;

if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
	console.error("Error: --limit must be a positive integer.");
	process.exit(1);
}

const options = limit !== undefined ? { limit } : undefined;

try {
	if (opts.analyze) {
		const result = inspect(pattern, options);
		if (result.safe) {
			console.log("✓ Pattern is safe.");
		} else {
			console.log(`✗ Pattern is unsafe (severity: ${result.severity}).`);
		}
		if (result.reasons.length > 0) {
			console.log("\nReasons:");
			for (const reason of result.reasons) {
				console.log(`  • ${reason}`);
			}
		}
		if (result.fix) {
			console.log(`\nSuggested fix: ${result.fix}`);
		}
		console.log("\nFull report:");
		console.log(JSON.stringify(result, null, 2));
	} else if (opts.fix) {
		const result = fix(pattern, options);
		if (result.fixed) {
			console.log(result.fixed);
		} else if (result.safe) {
			console.log("Pattern is already safe; no fix needed.");
		} else {
			console.error("Could not auto-fix this pattern.");
			process.exit(1);
		}
	} else {
		const result = inspect(pattern, options);
		if (result.safe) {
			console.log("✓ safe");
			process.exit(0);
		} else {
			console.log(`✗ ${result.severity}`);
			process.exit(1);
		}
	}
} catch (err) {
	console.error("Error:", err.message);
	process.exit(1);
}
