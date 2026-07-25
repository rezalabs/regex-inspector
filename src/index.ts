// ── Public API ────────────────────────────────────────────────────────────
//
// regex-inspector: Parse, reconstruct, and analyze regex patterns for ReDoS.
//
// Usage:
//   import { parse, generate, inspect, fix } from 'regex-inspector';
//
//   const ast = parse('(a+)+y');
//   const result = inspect(ast);
//   const fixed = fix('(a+)+');
//   const str = generate(ast);

// ── Core exports ─────────────────────────────────────────────────────────

export { analyze } from "./analyze.js";
export { fixRegex } from "./fix.js";
export { generate } from "./generator.js";
export { tokenize as parse } from "./parser.js";

// ── Type exports ─────────────────────────────────────────────────────────

export type {
	AnalysisResult,
	AnalyzeOptions,
	Severity,
} from "./analyze.js";
export type {
	BackreferenceNode,
	CharMember,
	CharNode,
	CharSetNode,
	GroupNode,
	Node,
	PositionNode,
	RangeMember,
	RepetitionNode,
	RootNode,
	SetMember,
	SetOpNode,
	StringMemberNode,
	Token,
	UnicodePropertyNode,
} from "./ast.js";

export type {
	FixOptions,
	FixResult,
} from "./fix.js";

// ── Convenience API ──────────────────────────────────────────────────────

import type { AnalysisResult, AnalyzeOptions } from "./analyze.js";
import { analyze } from "./analyze.js";
import type { FixOptions, FixResult } from "./fix.js";
import { fixRegex as fixImpl } from "./fix.js";
import { tokenize } from "./parser.js";

/**
 * Coerces any input to a string: RegExp → .source, else → String().
 * Uses cross-realm-safe detection via Object.prototype.toString
 * instead of instanceof, which fails across iframes/vm contexts.
 */
function coerceToString(input: unknown): string {
	if (
		input !== null &&
		input !== undefined &&
		Object.prototype.toString.call(input) === "[object RegExp]"
	) {
		return (input as RegExp).source;
	}
	if (typeof input === "string") return input;
	return String(input);
}

/**
 * Classifies a caught error into a human-readable reason string.
 *
 * Parse errors (SyntaxError, including the parser's ParseError subclass)
 * describe invalid input. RangeError indicates the analysis exceeded the
 * recursion limit on a syntactically valid but pathologically deep pattern.
 * Anything else is an unexpected internal failure. Each gets a distinct,
 * honest message so callers are never told their syntax is invalid when it
 * is not.
 */
function describeFailure(err: unknown): string {
	const e = err as Error;
	if (e instanceof RangeError) {
		return "Pattern too complex to analyze reliably (exceeded recursion depth); simplify deeply nested groups or quantifiers";
	}
	if (e instanceof SyntaxError) {
		return `Invalid regex syntax: ${e.message}`;
	}
	return `Analysis failed: ${e.message}`;
}

/**
 * Parses a regex pattern and returns a full ReDoS analysis including
 * severity level, reasons, and a suggested fix if unsafe.
 *
 * Accepts strings, RegExp objects, or any value coercible to string.
 *
 * Never throws: invalid syntax, patterns too complex to analyze, and
 * unexpected errors all produce a structured result. The result is
 * fail-closed (safe: false, severity: "high") because a pattern that
 * cannot be proven safe must be treated as unsafe.
 */
export function inspect(
	pattern: string | RegExp | unknown,
	opts?: AnalyzeOptions,
): AnalysisResult {
	try {
		const source = coerceToString(pattern);
		const ast = tokenize(source);
		const result = analyze(ast, opts);

		if (!result.safe) {
			const fixResult = fixImpl(ast, { limit: opts?.limit });
			if (fixResult.fixed) {
				result.fix = fixResult.fixed;
			}
		}

		return result;
	} catch (err) {
		return {
			safe: false,
			severity: "high",
			reasons: [describeFailure(err)],
			starHeight: 0,
			repCount: 0,
			hasAlternationReDoS: false,
			hasSequentialOverlap: false,
			anchored: false,
			hasStaticSuffix: false,
			fix: null,
		};
	}
}

/**
 * Attempts to automatically fix a ReDoS-vulnerable regex pattern.
 *
 * Accepts strings, RegExp objects, or any value coercible to string.
 *
 * Never throws, mirroring inspect(): a pattern too complex to fix (or any
 * unexpected failure) yields a fail-closed result with no fix. Call inspect()
 * to obtain the diagnostic reasons when fixed is null.
 */
export function fix(
	pattern: string | RegExp | unknown,
	opts?: FixOptions,
): FixResult {
	const source = coerceToString(pattern);
	try {
		return fixImpl(source, opts);
	} catch {
		return {
			safe: false,
			fixed: null,
			original: source,
			semanticChange: false,
		};
	}
}
