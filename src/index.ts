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
 * Parses a regex pattern and returns a full ReDoS analysis including
 * severity level, reasons, and a suggested fix if unsafe.
 *
 * Accepts strings, RegExp objects, or any value coercible to string.
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
			reasons: [`Invalid regex syntax: ${(err as Error).message}`],
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
 */
export function fix(
	pattern: string | RegExp | unknown,
	opts?: FixOptions,
): FixResult {
	const source = coerceToString(pattern);
	return fixImpl(source, opts);
}
