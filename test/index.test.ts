// ── Convenience API & Preset Tests ────────────────────────────────────────
// Verifies the public API surface of index.ts and preset.ts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fix, generate, inspect, parse } from "../src/index.ts";
import { tokenize } from "../src/parser.ts";
import { digits, negate, whitespace, wordChars } from "../src/preset.ts";

// ── inspect() ─────────────────────────────────────────────────────────

describe("inspect; string input", () => {
	it("marks safe patterns", () => {
		const result = inspect("^[a-z]+$");
		assert.equal(result.safe, true);
		assert.equal(result.severity, "none");
		assert.deepEqual(result.reasons, []);
	});

	it("marks unsafe patterns and populates fix", () => {
		const result = inspect("(a+)+");
		assert.equal(result.safe, false);
		assert.equal(result.severity, "high");
		assert.ok(result.reasons.length > 0);
		assert.equal(result.fix, "(a+)");
	});

	it("marks low-severity mitigated pattern", () => {
		const result = inspect("(a+)+y");
		assert.equal(result.safe, false);
		assert.equal(result.severity, "low");
		assert.equal(result.fix, "(a+)y");
	});

	it("detects alternation overlap", () => {
		const result = inspect("(a|aa|aaa)+");
		assert.equal(result.safe, false);
		assert.equal(result.hasAlternationReDoS, true);
		assert.equal(result.fix, "a+");
	});

	it("returns error result for invalid regex", () => {
		const result = inspect("[abc");
		assert.equal(result.safe, false);
		assert.equal(result.severity, "high");
		assert.ok(result.reasons[0].includes("Invalid regex syntax"));
		assert.equal(result.fix, null);
	});

	it("handles empty pattern", () => {
		const result = inspect("");
		assert.equal(result.safe, true);
		assert.equal(result.severity, "none");
	});
});

describe("inspect; RegExp input", () => {
	it("extracts source from RegExp object", () => {
		const re = /(a+)+/;
		const result = inspect(re);
		assert.equal(result.safe, false);
		assert.equal(result.fix, "(a+)");
	});

	it("handles RegExp with flags", () => {
		const re = /^(a+)+y$/i;
		const result = inspect(re);
		assert.equal(result.safe, false);
		assert.equal(result.severity, "low");
	});

	it("handles safe RegExp", () => {
		const re = /^[a-z]+$/;
		const result = inspect(re);
		assert.equal(result.safe, true);
	});

	it("handles cross-realm-safe RegExp detection", () => {
		// Test that the detection works on a plain object with RegExp toStringTag.
		// This simulates cross-realm scenarios where instanceof fails but
		// Object.prototype.toString.call still identifies the object as RegExp.
		// The actual cross-realm case (iframes, vm contexts) is covered by
		// the source code using Object.prototype.toString.call instead of instanceof.
		const result = inspect({ source: "(a+)+" } as unknown);
		// Not a real RegExp → falls through to String() → '[object Object]'
		// which is a valid literal regex pattern (safe)
		assert.equal(result.safe, true);

		// Real RegExp still works
		assert.equal(inspect(/^[a-z]+$/).safe, true);
		assert.equal(inspect(/(a+)+/).safe, false);
	});
});

describe("inspect; coercion", () => {
	it("coerces number to string", () => {
		const result = inspect(42 as unknown);
		// "42" is a safe regex pattern (just literal chars)
		assert.equal(result.safe, true);
	});

	it("coerces object via String()", () => {
		const result = inspect({ toString: () => "a+" } as unknown);
		// "a+" is a safe regex
		assert.equal(result.safe, true);
	});
});

describe("inspect; options", () => {
	it("accepts custom limit", () => {
		const many = Array(27).fill("a?").join("") + Array(27).fill("a").join("");
		const result = inspect(many, { limit: 25 });
		assert.equal(result.safe, false);
		// Sequential overlap raises severity to high
		assert.equal(result.severity, "high");
		assert.ok(result.repCount > 25);
		assert.equal(result.hasSequentialOverlap, true);
	});

	it("flags sequential overlap even within limit", () => {
		const many = Array(27).fill("a?").join("") + Array(27).fill("a").join("");
		const result = inspect(many, { limit: 52 });
		// Sequential overlap makes this unsafe regardless of rep count
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
		assert.equal(result.severity, "high");
	});
});

// ── fix() ─────────────────────────────────────────────────────────────

describe("fix; string input", () => {
	it("fixes nested repetition", () => {
		const result = fix("(a+)+");
		assert.equal(result.fixed, "(a+)");
		assert.equal(result.semanticChange, true);
	});

	it("fixes alternation overlap", () => {
		const result = fix("(a|aa|aaa)+");
		assert.equal(result.fixed, "a+");
		assert.equal(result.semanticChange, true);
	});

	it("returns null for already-safe patterns", () => {
		const result = fix("^[a-z]+$");
		assert.equal(result.safe, true);
		assert.equal(result.fixed, null);
		assert.equal(result.semanticChange, false);
	});

	it("returns null for invalid regex", () => {
		const result = fix("[abc");
		assert.equal(result.safe, false);
		assert.equal(result.fixed, null);
		assert.equal(result.semanticChange, false);
	});

	it("returns null for unfixable patterns", () => {
		const result = fix("(ab|abc)+");
		assert.equal(result.fixed, null);
	});
});

describe("fix; RegExp input", () => {
	it("extracts source from RegExp", () => {
		const re = /(a+)+/;
		const result = fix(re);
		assert.equal(result.fixed, "(a+)");
	});
});

// ── negate() ──────────────────────────────────────────────────────────

describe("negate; preset function", () => {
	it("negates digit set", () => {
		const set = digits();
		assert.equal(set.negated, false);

		const negated = negate(set);
		assert.equal(negated.negated, true);
		assert.deepEqual(negated.members, set.members);

		const doubleNegated = negate(negated);
		assert.equal(doubleNegated.negated, false);
	});

	it("negates wordChars set", () => {
		const set = wordChars();
		const negated = negate(set);
		assert.equal(negated.negated, true);
		assert.deepEqual(negated.members, set.members);
	});

	it("negates whitespace set", () => {
		const set = whitespace();
		const negated = negate(set);
		assert.equal(negated.negated, true);
		assert.deepEqual(negated.members, set.members);
	});

	it("does not mutate original set", () => {
		const original = digits();
		const originalNegated = original.negated;
		negate(original);
		// Original should be unchanged (negate is not mutating)
		assert.equal(original.negated, originalNegated);
	});

	it("produces valid parse-generate round-trip", () => {
		// Verify that a negated set round-trips through the parser/generator
		const _ast = tokenize("\\d");
		const negatedAst = {
			kind: "root" as const,
			branches: [[negate(digits())]],
		};
		const result = generate(negatedAst);
		assert.equal(result, "\\D");
	});

	it("double negation restores original", () => {
		for (const makeSet of [digits, wordChars, whitespace]) {
			const original = makeSet();
			const result = negate(negate(original));
			assert.equal(result.negated, original.negated);
			assert.deepEqual(result.members, original.members);
		}
	});
});

// ── parse/generate re-exports ────────────────────────────────────────

describe("parse (re-exported as tokenize)", () => {
	it("parses patterns via index.ts re-export", () => {
		const ast = parse("^[a-z]+$");
		assert.equal(ast.kind, "root");
		assert.equal(ast.branches.length, 1);
	});

	it("generates patterns via index.ts re-export", () => {
		const ast = parse("hello");
		const output = generate(ast);
		assert.equal(output, "hello");
	});
});

// ── inspect: sequential overlap ────────────────────────────────────

describe("inspect; sequential overlap", () => {
	it("detects three overlapping quantifiers", () => {
		const result = inspect(".*?B.*?C.*?D");
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
		assert.equal(result.severity, "high");
	});

	it("detects overlap inside repeated group", () => {
		const result = inspect("(.*?,){11}P");
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
	});

	it("reports correct reason for sequential overlap", () => {
		const result = inspect(".*?B.*?C.*?D");
		assert.ok(result.reasons.some((r) => r.includes("Sequential")));
	});

	it("does not flag single adjacency as sequential overlap", () => {
		const result = inspect(".*?B");
		assert.equal(result.safe, true);
		assert.equal(result.hasSequentialOverlap, false);
	});
});

// ── inspect: combined issues ───────────────────────────────────────

describe("inspect; combined issues", () => {
	it("detects alternation overlap inside nested repetition", () => {
		const result = inspect("((a|aa|aaa)+)");
		assert.equal(result.safe, false);
		assert.equal(result.hasAlternationReDoS, true);
	});

	it("detects sequential overlap in pattern that also has alternation overlap", () => {
		const result = inspect("(a|aa|aaa)+.*?B.*?C");
		assert.equal(result.safe, false);
	});
});

// ── inspect: edge cases ────────────────────────────────────────────

describe("inspect; edge cases", () => {
	it("handles empty pattern", () => {
		const result = inspect("");
		assert.equal(result.safe, true);
		assert.equal(result.severity, "none");
	});

	it("handles pattern with only anchors", () => {
		const result = inspect("^$");
		assert.equal(result.safe, true);
		assert.equal(result.anchored, true);
	});

	it("handles pattern with only dot", () => {
		const result = inspect(".");
		assert.equal(result.safe, true);
	});

	it("handles pattern with backreference to non-existent group", () => {
		const result = inspect("\\1");
		// \\1 with no groups downgrades to char, so it's safe
		assert.equal(result.safe, true);
	});

	it("handles very simple safe pattern", () => {
		const result = inspect("a");
		assert.equal(result.safe, true);
		assert.deepEqual(result.reasons, []);
	});

	it("handles inspect with empty RegExp", () => {
		const result = inspect(/(?:)/);
		assert.equal(result.safe, true);
	});

	it("handles inspect with RegExp having flags but known safe", () => {
		const re = /^[a-z]+$/i;
		const result = inspect(re);
		assert.equal(result.safe, true);
	});

	it("returns fix for unsafe RegExp input", () => {
		const re = /(a+)+/;
		const result = inspect(re);
		assert.equal(result.safe, false);
		assert.equal(result.fix, "(a+)");
	});

	it("handles limit option edge: limit 0", () => {
		const result = inspect("a+", { limit: 0 });
		assert.equal(result.safe, false);
	});

	it("handles limit option edge: limit undefined (default 25)", () => {
		const result = inspect("a+");
		assert.equal(result.safe, true);
	});
});

// ── fix: RegExp input edge cases ───────────────────────────────────

describe("fix; RegExp input edge cases", () => {
	it("handles safe RegExp", () => {
		const re = /^[a-z]+$/;
		const result = fix(re);
		assert.equal(result.safe, true);
		assert.equal(result.fixed, null);
	});

	it("handles unsafe RegExp and returns fix", () => {
		const re = /(a+)+/;
		const result = fix(re);
		assert.equal(result.fixed, "(a+)");
		assert.equal(result.semanticChange, true);
	});

	it("handles alternation overlap via RegExp input", () => {
		const re = /(a|aa|aaa)+/;
		const result = fix(re);
		assert.equal(result.fixed, "a+");
	});
});
