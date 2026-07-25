// ── CLI Tests ─────────────────────────────────────────────────────────────
// Verifies bin/regex-inspector.js end to end: exit codes, stdout/stderr
// stream discipline, and error paths. Builds dist/ once before running
// because the binary imports the compiled output.

import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const binPath = path.join(root, "bin", "regex-inspector.js");

type CliResult = {
	status: number | null;
	stdout: string;
	stderr: string;
};

function runCli(args: string[]): CliResult {
	const result = spawnSync(process.execPath, [binPath, ...args], {
		cwd: root,
		encoding: "utf-8",
	});
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

describe("CLI", () => {
	before(() => {
		execSync("npm run build", { cwd: root, stdio: "ignore" });
	});

	// ── Quick safety check ──────────────────────────────────────────

	describe("quick check", () => {
		it("exits 0 and prints safe verdict for a safe pattern", () => {
			const { status, stdout } = runCli(["^[a-z]+$"]);
			assert.equal(status, 0);
			assert.equal(stdout.trim(), "✓ safe");
		});

		it("exits 1 and prints severity for an unsafe pattern", () => {
			const { status, stdout, stderr } = runCli(["(a+)+"]);
			assert.equal(status, 1);
			assert.equal(stdout.trim(), "✗ high");
			assert.ok(stderr.includes("--analyze"), "hints at --analyze on stderr");
		});

		it("mentions --fix in the hint when an auto-fix exists", () => {
			const { status, stderr } = runCli(["(a+)+"]);
			assert.equal(status, 1);
			assert.ok(stderr.includes("--fix"));
		});

		it("accepts dash-leading patterns after --", () => {
			const { status, stdout } = runCli(["--", "-a+"]);
			assert.equal(status, 0);
			assert.equal(stdout.trim(), "✓ safe");
		});

		it("prints the top reason on stderr for an unsafe pattern", () => {
			const { status, stdout, stderr } = runCli(["(a+)+"]);
			assert.equal(status, 1);
			// stdout stays stable for scripts
			assert.equal(stdout.trim(), "✗ high");
			// stderr now carries the diagnostic reason, not just the hint
			assert.ok(stderr.includes("Nested repetition"), "shows the reason");
			assert.ok(stderr.includes("--analyze"), "still hints at --analyze");
		});
	});

	// ── Invalid patterns ────────────────────────────────────────────

	describe("invalid patterns", () => {
		it("reports a parse error instead of an unsafe verdict", () => {
			const { status, stdout, stderr } = runCli(["[abc"]);
			assert.equal(status, 1);
			assert.equal(stdout, "", "keeps stdout clean for scripts");
			assert.ok(stderr.includes("Unterminated character class"));
			assert.ok(!stderr.includes("severity"), "does not label it unsafe");
		});
	});

	// ── Argument handling ───────────────────────────────────────────

	describe("argument handling", () => {
		it("rejects unknown options without a stack trace", () => {
			const { status, stderr } = runCli(["-x", "(a+)+"]);
			assert.equal(status, 1);
			assert.ok(stderr.includes("Unknown option"));
			assert.ok(stderr.includes("--help"));
			assert.ok(!stderr.includes("node:internal"), "no raw stack trace");
		});

		it("rejects a missing regex argument with usage guidance", () => {
			const { status, stdout, stderr } = runCli([]);
			assert.equal(status, 1);
			assert.equal(stdout, "");
			assert.ok(stderr.includes("Missing regex argument"));
			assert.ok(stderr.includes("Usage: regex-inspector"));
		});

		it("rejects extra positional arguments and suggests quoting", () => {
			const { status, stderr } = runCli(["a+", "b+"]);
			assert.equal(status, 1);
			assert.ok(stderr.includes("Quote the pattern"));
		});

		it("prints the version with --version", () => {
			const { status, stdout } = runCli(["--version"]);
			assert.equal(status, 0);
			assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
		});

		it("prints help with --help", () => {
			const { status, stdout } = runCli(["--help"]);
			assert.equal(status, 0);
			assert.ok(stdout.includes("Usage: regex-inspector"));
			assert.ok(stdout.includes("--analyze"));
		});
	});

	// ── --limit validation ──────────────────────────────────────────

	describe("--limit validation", () => {
		it("rejects trailing garbage", () => {
			const { status, stderr } = runCli(["-l", "50abc", "(a+)+"]);
			assert.equal(status, 1);
			assert.ok(stderr.includes("positive integer"));
		});

		it("rejects non-integer values", () => {
			const { status, stderr } = runCli(["-l", "5.7", "(a+)+"]);
			assert.equal(status, 1);
			assert.ok(stderr.includes("positive integer"));
		});

		it("rejects zero", () => {
			const { status, stderr } = runCli(["-l", "0", "(a+)+"]);
			assert.equal(status, 1);
			assert.ok(stderr.includes("positive integer"));
		});

		it("accepts a valid limit", () => {
			const { status, stdout } = runCli(["-l", "50", "^[a-z]+$"]);
			assert.equal(status, 0);
			assert.equal(stdout.trim(), "✓ safe");
		});
	});

	// ── Analyze mode ────────────────────────────────────────────────

	describe("analyze mode", () => {
		it("writes parseable JSON to stdout and the summary to stderr", () => {
			const { status, stdout, stderr } = runCli(["-a", "(a+)+"]);
			assert.equal(status, 1);
			const report = JSON.parse(stdout);
			assert.equal(report.safe, false);
			assert.equal(report.severity, "high");
			assert.equal(report.fix, "(a+)");
			assert.ok(stderr.includes("unsafe"));
			assert.ok(stderr.includes("Suggested fix: (a+)"));
		});

		it("exits 0 for a safe pattern", () => {
			const { status, stdout, stderr } = runCli(["-a", "^[a-z]+$"]);
			assert.equal(status, 0);
			const report = JSON.parse(stdout);
			assert.equal(report.safe, true);
			assert.ok(stderr.includes("safe"));
		});

		it("notes that --fix is ignored when combined with --analyze", () => {
			const { status, stdout, stderr } = runCli(["-a", "-f", "(a+)+"]);
			assert.equal(status, 1);
			assert.ok(stderr.includes("--fix is ignored"));
			assert.equal(JSON.parse(stdout).safe, false);
		});
	});

	// ── Fix mode ────────────────────────────────────────────────────

	describe("fix mode", () => {
		it("prints the fixed pattern and a behavior-change note", () => {
			const { status, stdout, stderr } = runCli(["-f", "(a+)+"]);
			assert.equal(status, 0);
			assert.equal(stdout.trim(), "(a+)");
			assert.ok(stderr.includes("review it before adopting"));
		});

		it("passes an already-safe pattern through unchanged", () => {
			const { status, stdout, stderr } = runCli(["-f", "^[a-z]+$"]);
			assert.equal(status, 0);
			assert.equal(stdout.trim(), "^[a-z]+$");
			assert.ok(stderr.includes("already safe"));
		});

		it("explains why an unfixable pattern is unsafe", () => {
			const { status, stdout, stderr } = runCli(["-f", "(ab|abc)+"]);
			assert.equal(status, 1);
			assert.equal(stdout, "", "keeps stdout clean when no fix exists");
			assert.ok(stderr.includes("Could not auto-fix"));
			assert.ok(stderr.includes("overlapping"), "lists the analysis reasons");
			assert.ok(stderr.includes("--analyze"));
		});
	});
});
