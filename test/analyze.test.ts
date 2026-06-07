// ── Analyzer & Fix Tests ──────────────────────────────────────────────────
// Verifies ReDoS detection, severity scoring, and auto-fix.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze } from "../src/analyze.ts";
import type { RootNode } from "../src/ast.ts";
import { fixRegex } from "../src/fix.ts";
import { tokenize } from "../src/parser.ts";

function inspectPat(pattern: string, limit?: number) {
	const ast = tokenize(pattern);
	return analyze(ast, { limit });
}

function fixPat(pattern: string, limit?: number) {
	return fixRegex(pattern, { limit });
}

// ── Safe patterns ───────────────────────────────────────────────────

describe("Analyze; safe patterns", () => {
	// Trivially safe patterns (no star height issues)
	const trivialSafe = [
		"^[a-z]+$",
		"(a|b|c)+",
		"(abc|def)+",
		"a+b+",
		"\\bOakland\\b",
		"/^\\d+1337\\d+$/i".replace(/\//g, ""),
	];

	for (const re of trivialSafe) {
		it(`marks "${re}" as safe (trivial)`, () => {
			const result = inspectPat(re);
			assert.equal(result.safe, true, `Expected ${re} to be safe`);
			assert.equal(result.severity, "none");
			assert.deepEqual(result.reasons, []);
		});
	}

	// Unambiguous nested repetition (safe despite star height > 1)
	const unambiguousSafe = [
		"(a+b+|c+d+)+y",
		"(a+b+)+",
		"([a-z]+[0-9]+)+",
		"(\\d+\\s+)+",
		"(a+b+|c+d+|e+f+)+",
	];

	for (const re of unambiguousSafe) {
		it(`marks "${re}" as safe (unambiguous nested rep)`, () => {
			const result = inspectPat(re);
			assert.equal(result.safe, true, `Expected ${re} to be safe`);
			assert.equal(result.severity, "none", `Expected severity none`);
			assert.deepEqual(result.reasons, [], `Expected no reasons`);
		});
	}
});

// ── Unsafe: nested repetition ───────────────────────────────────────

describe("Analyze; nested repetition", () => {
	const cases: { re: string; severity: string; starHeight: number }[] = [
		{ re: "(a+)+", severity: "high", starHeight: 2 },
		{ re: "(a+)+y", severity: "low", starHeight: 2 },
		{ re: "(x+x+)+y", severity: "low", starHeight: 2 },
		{ re: "((a+)+)+", severity: "critical", starHeight: 3 },
		{ re: "(((a+)+)+)+", severity: "critical", starHeight: 4 },
	];

	for (const { re, severity, starHeight } of cases) {
		it(`detects "${re}" as ${severity} (star height ${starHeight})`, () => {
			const result = inspectPat(re);
			assert.equal(result.safe, false);
			assert.equal(result.severity, severity);
			assert.equal(result.starHeight, starHeight);
			assert.ok(result.reasons.length > 0);
		});
	}

	it("reports correct reason string", () => {
		const result = inspectPat("(a+)+");
		assert.ok(result.reasons[0].includes("star height 2"));
	});
});

// ── Unsafe: alternation overlap ─────────────────────────────────────

describe("Analyze; alternation overlap", () => {
	const overlapPatterns = [
		"(a|aa|aaa)+",
		"(?:a|aa|aaa)+",
		"(?:(a|aa|aaa))+",
		"(x|xx|xxx)+",
		"(ab|abc)+",
		"(12|123)+",
	];

	for (const re of overlapPatterns) {
		it(`detects "${re}" as alternation ReDoS`, () => {
			const result = inspectPat(re);
			assert.equal(result.safe, false, `Expected ${re} to be unsafe`);
			assert.equal(result.hasAlternationReDoS, true);
			assert.equal(result.severity, "high");
		});
	}

	it("reports overlap reason", () => {
		const result = inspectPat("(a|aa|aaa)+");
		const hasOverlap = result.reasons.some(
			(r) => r.includes("overlapping") || r.includes("Overlap"),
		);
		assert.equal(hasOverlap, true);
	});
});

// ── SET-prefix alternation overlap ──────────────────────────────────

describe("Analyze; SET-prefix alternation overlap", () => {
	const overlapPatterns = [
		"([a-z]|[a-z][a-z])+",
		"(.|..)+",
		"([ab]|[ab][ab])+",
		"([0-9]|[0-9][0-9])+",
		"(\\d|\\d\\d)+",
		"([a]b|[a]bc)+",
		"(a|[a-z])+",
		"(a|[a-z][a-z])+",
	];

	for (const re of overlapPatterns) {
		it(`detects "${re}" as unsafe`, () => {
			const result = inspectPat(re);
			assert.equal(result.safe, false, `Expected ${re} to be unsafe`);
			assert.equal(result.hasAlternationReDoS, true);
			assert.equal(result.severity, "high");
		});
	}

	it("marks overlapping non-negated sets as unsafe", () => {
		// Both sets are non-negated AND overlap → ReDoS
		const result = inspectPat("([a-z]|[a-c])+");
		assert.equal(result.safe, false);
		assert.equal(result.hasAlternationReDoS, true);
	});

	it("marks disjoint sets as safe", () => {
		const safe = [
			"([a-z]|[0-9])+",
			"([a-z]|[A-Z])+",
			"(A|[a-z])+",
			"(0|[a-z])+",
		];
		for (const re of safe) {
			const result = inspectPat(re);
			assert.equal(result.safe, true, `Expected ${re} to be safe`);
			assert.equal(result.hasAlternationReDoS, false);
		}
	});
});

// ── Unambiguous nested repetition ───────────────────────────────────

describe("Analyze; unambiguous nested repetition", () => {
	it("handles position anchor as second branch element", () => {
		// (a+$)+ triggers getFirstLeaf on a position anchor (returns null)
		// → isUnambiguous returns false → star height > 1 triggers unsafe
		const result = inspectPat("(a+$)+");
		assert.equal(result.safe, false);
		assert.equal(result.starHeight, 2);
	});

	it("marks mutually exclusive alternatives as safe", () => {
		const safe = [
			"(a+b+|c+d+)+y",
			"(a+b+)+",
			"([a-z]+[0-9]+)+",
			"(\\d+\\s+)+",
			"(\\d+[a-z]+)+",
		];
		for (const re of safe) {
			const result = inspectPat(re);
			assert.equal(result.safe, true, `Expected ${re} to be safe`);
		}
	});

	it("marks disjoint single-token alternatives as safe", () => {
		// (a+|b+)+: a and b are disjoint → unambiguous → safe
		// (\d+|\s+)+: \d and \s are disjoint → unambiguous → safe
		const safe = ["(a+|b+)+", "(\\d+|\\s+)+"];
		for (const re of safe) {
			const result = inspectPat(re);
			assert.equal(result.safe, true, `Expected ${re} to be safe`);
		}
	});

	it("marks overlapping single-token alternatives via isUnambiguous", () => {
		// (a+|a+)+: both branches start with 'a' → overlap via isUnambiguous
		// This is a nested repetition (star height 2), so isUnambiguous
		// checks the cross-branch first leaves.
		const result = inspectPat("(a+|a+)+");
		assert.equal(result.safe, false);
		assert.equal(result.starHeight, 2);
	});

	it("marks disjoint single-token alternatives as safe via isUnambiguous", () => {
		// (a+|b+)+: a and b are disjoint → unambiguous → safe
		const result = inspectPat("(a+|b+)+");
		assert.equal(result.safe, true);
	});

	it("marks same-char tokens as unsafe", () => {
		const unsafe = ["(x+x+)+y", "(a+a+)+", "(\\d+\\d+)+"];
		for (const re of unsafe) {
			const result = inspectPat(re);
			assert.equal(result.safe, false, `Expected ${re} to be unsafe`);
		}
	});

	it("marks optional start as unsafe", () => {
		const result = inspectPat("(a*b+)+");
		assert.equal(result.safe, false);
	});

	it("checks inner alternation against following token", () => {
		assert.equal(inspectPat("((a|b)c+)+").safe, true, "a,b disjoint from c");
		assert.equal(inspectPat("((a|c)c+)+").safe, false, "c overlaps c+");
	});

	it("treats unicode property as non-optional in isUnambiguous", () => {
		// \\p{L} always consumes a character if it matches, so it is
		// non-optional. With leaf extraction now returning unicode_property
		// nodes, tokensOverlap conservatively assumes overlap, so the
		// pattern is still flagged unsafe (conservative but correct).
		const result = inspectPat("(\\p{L}\\d+)+y");
		assert.equal(result.safe, false);
		assert.equal(result.starHeight, 2);
		assert.ok(result.reasons.length > 0);
	});

	it("detects nested charset overlap when one set is negated", () => {
		// [^0-9] vs [\\d]: \\d is digits [0-9], negated set excludes them →
		// no overlap. [^a-z] vs [\\d]: digits are not a-z, so [^a-z]
		// includes digits → overlap.
		const noOverlap = inspectPat("([^0-9]|[0-9])+");
		// [^0-9] and [0-9] have no overlap → safe
		assert.equal(noOverlap.safe, true);

		const hasOverlap = inspectPat("([^a-z]|[0-9])+");
		// [^a-z] does include 0-9 → overlap → unsafe
		assert.equal(hasOverlap.safe, false);
		assert.equal(hasOverlap.hasAlternationReDoS, true);
	});

	// ── Unicode property leaf extraction ──────────────────────────

	it("extracts unicode_property as first leaf", () => {
		// \\p{L} should be returned by getAllFirstLeaves and getFirstLeaf
		const result = inspectPat("(\\p{L})+y");
		// The inner repetition child ends with \\p{L} (a unicode property).
		// tokensOverlap(\\p{L}, y) is conservative true → suffix NOT exclusive.
		assert.equal(result.hasStaticSuffix, false);
	});

	it("conservatively flags unicode_property overlap in sequential checks", () => {
		// \\p{L}+\\d+ : \\p{L} overlaps with \\d (conservative) → danger adjacency
		const result = inspectPat("\\p{L}+\\d+");
		// hasDangerAdjacency: tokensOverlap(\\p{L}, \\d) → conservative true
		// But there's only 1 adjacency → safe by the ≥2 threshold.
		// However, the rep count and star height are both 1 → safe.
		assert.equal(result.hasSequentialOverlap, false);
	});

	it("flags unicode_property as present in codeInMembers", () => {
		// [\\p{L}] in an alternation: should assume the char 'a' is in \\p{L}
		// (conservative) → overlap.
		const result = inspectPat("([\\p{L}]|[a])+");
		assert.equal(result.safe, false);
		assert.equal(result.hasAlternationReDoS, true);
	});

	// ── getPrefixTokens handles repetitions ───────────────────────

	it("detects alternation overlap when branches start with repetitions", () => {
		// (\\d+|[0-9]+) WITHOUT an outer +: hasAlternationReDoS is true
		// (getPrefixTokens now extracts first leaves), but the pattern is safe
		// because the group is not quantifier-wrapped.
		const noOuterPlus = inspectPat("(\\d+|[0-9]+)");
		assert.equal(noOuterPlus.hasAlternationReDoS, true);
		assert.equal(noOuterPlus.safe, true); // no quantifier → safe

		// (\\d+|[0-9]+)+ WITH an outer +: now dangerous.
		const withOuterPlus = inspectPat("(\\d+|[0-9]+)+");
		assert.equal(withOuterPlus.hasAlternationReDoS, true);
		assert.equal(withOuterPlus.safe, false);
	});

	it("getPrefixTokens recursion does not cause false positives", () => {
		// (\\d+|[a-z]+): digit vs letter → disjoint → no alternation overlap
		const result = inspectPat("(\\d+|[a-z]+)");
		assert.equal(result.hasAlternationReDoS, false);
	});

	it("getPrefixTokens handles repetition with multi-char prefix after", () => {
		// (\\d+|[0-9]a): digit set vs [0-9] → overlap at first position → ReDoS
		const result = inspectPat("(\\d+|[0-9]a)+");
		assert.equal(result.hasAlternationReDoS, true);
	});
});

// ── Anchoring and suffix detection ──────────────────────────────────

describe("Analyze; anchoring and suffix", () => {
	it("detects anchored pattern", () => {
		assert.equal(inspectPat("^a$").anchored, true);
		assert.equal(inspectPat("^a").anchored, false);
		assert.equal(inspectPat("a$").anchored, false);
		assert.equal(inspectPat("a").anchored, false);
		assert.equal(inspectPat("^$").anchored, true);
	});

	it("detects static suffix", () => {
		assert.equal(
			inspectPat("a+").hasStaticSuffix,
			false,
			"a+ is a repetition, not trailing literal",
		);
		assert.equal(inspectPat("(a+)+").hasStaticSuffix, false);
		assert.equal(inspectPat("(a+)+y").hasStaticSuffix, true);
		assert.equal(inspectPat("a+b").hasStaticSuffix, true);
	});

	it("mitigation reduces severity", () => {
		const result = inspectPat("^(a+)+y$");
		assert.equal(result.safe, false);
		assert.equal(result.severity, "low");
		assert.equal(result.anchored, true);
		assert.equal(result.hasStaticSuffix, true);
	});

	it("critical severity is not mitigated", () => {
		const result = inspectPat("^((a+)+)+y$");
		assert.equal(result.severity, "critical");
	});
});

// ── Repetition count ────────────────────────────────────────────────

describe("Analyze; repetition count", () => {
	it("rejects pattern exceeding limit", () => {
		const many = Array(27).fill("a?").join("") + Array(27).fill("a").join("");
		const result = inspectPat(many, 25);
		assert.equal(result.safe, false);
		// Sequential overlap (26 danger adjacencies) raises severity to high
		assert.equal(result.severity, "high");
		assert.ok(result.repCount > 25);
		assert.equal(result.hasSequentialOverlap, true);
	});

	it("flags pattern with sequential overlap even within limit", () => {
		const many = Array(27).fill("a?").join("") + Array(27).fill("a").join("");
		const result = inspectPat(many, 52);
		// Sequential overlap makes this unsafe regardless of rep count limit
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
		assert.equal(result.severity, "high");
	});
});

// ── General alternation overlap ─────────────────────────────────────

describe("Analyze; general prefix overlap", () => {
	const cases = ["(ab|abc)+", "(12|123)+", "(cat|cater|caterpillar)+"];
	for (const re of cases) {
		it(`detects "${re}" as unsafe`, () => {
			const result = inspectPat(re);
			assert.equal(result.hasAlternationReDoS, true);
			assert.equal(result.severity, "high");
		});
	}
});

// ── Sequential overlap detection ────────────────────────────────────

describe("Analyze; sequential overlapping quantifiers", () => {
	it("detects consecutive .*? quantifiers", () => {
		// .*?B.*?C.*?D; 3 overlapping adjacencies -> O(N^3)
		const result = inspectPat(".*?B.*?C.*?D");
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
		assert.equal(result.severity, "high");
	});

	it("detects the HTML-like pattern from regular-expressions.info", () => {
		// .*?<head>.*?<title>.*?</title>; O(N^3) when </title> missing
		const result = inspectPat(".*?<head>.*?<title>.*?</title>");
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
	});

	it("detects overlap inside a repeated group", () => {
		// (.*?,){11}P; .*? overlaps comma inside the repeated group
		const result = inspectPat("(.*?,){11}P");
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
		assert.equal(result.hasStaticSuffix, false); // dot overlaps P too
	});

	it("marks single danger adjacency as safe (O(N) is acceptable)", () => {
		// .*?B; only 1 adjacency
		assert.equal(inspectPat(".*?B").safe, true);
		assert.equal(inspectPat(".*?B").hasSequentialOverlap, false);
	});

	it("marks two non-overlapping quantifiers as safe", () => {
		// a+b+; a does not overlap b
		assert.equal(inspectPat("a+b+").safe, true);
		assert.equal(inspectPat("a+b+").hasSequentialOverlap, false);
	});

	it("marks exclusive-charset quantifiers as safe", () => {
		// [^,]*,[^,]*; [^,] does not overlap comma
		assert.equal(inspectPat("[^,]*,[^,]*").safe, true);
		assert.equal(inspectPat("[^,]*,[^,]*").hasSequentialOverlap, false);
	});

	it("marks literal followed by quantifier as safe", () => {
		// ^\d+1337\d+; 7 (literal) followed by \d+ is not a danger adjacency
		assert.equal(inspectPat("^\\d+1337\\d+$").safe, true);
		assert.equal(inspectPat("^\\d+1337\\d+$").hasSequentialOverlap, false);
	});

	it("detects three overlapping same-domain quantifiers", () => {
		// \d+\d+\d+; 3 digit quantifiers in a row -> O(N^2)
		const result = inspectPat("\\d+\\d+\\d+");
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
	});

	it("treats two same-domain quantifiers as safe", () => {
		// \d+\d+; only 1 adjacency, O(N), acceptable
		assert.equal(inspectPat("\\d+\\d+").safe, true);
	});

	it("detects consecutive .? lazy dots", () => {
		// .?.?.?; 3 lazy dots -> 2 adjacencies
		const result = inspectPat(".?.?.?");
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
	});

	it("does not double-count alternation overlap as sequential", () => {
		// (a|aa|aaa)+ is alternation overlap, not sequential
		const result = inspectPat("(a|aa|aaa)+");
		assert.equal(result.hasAlternationReDoS, true);
		assert.equal(result.hasSequentialOverlap, false);
	});

	it("handles patterns without quantifiers as safe", () => {
		assert.equal(inspectPat("abc").safe, true);
		assert.equal(inspectPat("abc").hasSequentialOverlap, false);
	});
});

// ── Suffix exclusivity ──────────────────────────────────────────────

describe("Analyze; suffix exclusivity mitigation", () => {
	it("suffix is exclusive when preceding quantifier cannot match it", () => {
		// (a+)+y; a cannot match y
		const result = inspectPat("(a+)+y");
		assert.equal(result.hasStaticSuffix, true);
		assert.equal(result.severity, "low"); // mitigated by exclusive suffix
	});

	it("suffix is NOT exclusive when dot can match it", () => {
		// (.*?)+y; dot matches y
		const result = inspectPat("(.*?)+y");
		assert.equal(result.hasStaticSuffix, false);
		assert.equal(result.severity, "high"); // not mitigated
	});

	it("suffix is NOT exclusive when preceding charset includes it", () => {
		// (.*?,){11}P; dot matches P
		const result = inspectPat("(.*?,)P");
		assert.equal(result.hasStaticSuffix, false);
	});

	it("exclusive suffix reduces star-height-2 severity", () => {
		// (x+x+)+y; x does not match y -> low
		const result = inspectPat("(x+x+)+y");
		assert.equal(result.hasStaticSuffix, true);
		assert.equal(result.severity, "low");
	});

	it("static suffix for literal-only patterns", () => {
		assert.equal(inspectPat("a+b").hasStaticSuffix, true);
		assert.equal(inspectPat("a*b").hasStaticSuffix, true);
	});

	it("no static suffix when pattern ends with quantifier", () => {
		assert.equal(inspectPat("a+").hasStaticSuffix, false);
		assert.equal(inspectPat(".*?").hasStaticSuffix, false);
	});
});

// ── Fix: nested repetition ──────────────────────────────────────────

describe("Fix; nested repetition", () => {
	const cases: { re: string; expect: string }[] = [
		{ re: "(a+)+", expect: "(a+)" },
		{ re: "(a+)+y", expect: "(a+)y" },
		{ re: "(x+x+)+y", expect: "(x+x+)y" },
		{ re: "(a+){10}y", expect: "(a+)y" },
		{ re: "foo|(x+x+)+y", expect: "foo|(x+x+)y" },
	];

	for (const { re, expect } of cases) {
		it(`fixes "${re}" → "${expect}"`, () => {
			const result = fixPat(re);
			assert.equal(result.fixed, expect, `Expected ${re} → ${expect}`);
			// Verify the fix is safe
			if (result.fixed) {
				const verifyAst = tokenize(result.fixed);
				const verifyResult = analyze(verifyAst);
				assert.equal(
					verifyResult.safe,
					true,
					`Fixed pattern ${result.fixed} should be safe`,
				);
			}
		});
	}
});

// ── Fix: alternation overlap ────────────────────────────────────────

describe("Fix; alternation overlap", () => {
	const cases: { re: string; expect: string }[] = [
		{ re: "(a|aa|aaa)+", expect: "a+" },
		{ re: "(a|aa|aaa)+y", expect: "a+y" },
		{ re: "(?:a|aa|aaa)+", expect: "a+" },
		{ re: "(?:(a|aa|aaa))+", expect: "a+" },
		{ re: "(x|xx|xxx)+", expect: "x+" },
	];

	for (const { re, expect } of cases) {
		it(`fixes "${re}" → "${expect}"`, () => {
			const result = fixPat(re);
			assert.equal(result.fixed, expect);
			if (result.fixed) {
				const verifyAst = tokenize(result.fixed);
				const verifyResult = analyze(verifyAst);
				assert.equal(verifyResult.safe, true);
			}
		});
	}
});

// ── Fix: unfixable patterns ─────────────────────────────────────────

describe("Fix; unfixable patterns", () => {
	it("returns null for general prefix overlap", () => {
		const cases = ["(ab|abc)+", "(12|123)+"];
		for (const re of cases) {
			const result = fixPat(re);
			assert.equal(result.fixed, null, `Expected ${re} to be unfixable`);
		}
	});

	it("returns null for invalid regex", () => {
		const cases = ["*Oakland*", "[abc", "abcde(?>hellow)"];
		for (const re of cases) {
			const result = fixPat(re);
			assert.equal(result.fixed, null);
			assert.equal(result.safe, false);
		}
	});

	it("returns safe:true and fixed:null for already-safe patterns", () => {
		const cases = ["^[a-z]+$", "(a|b|c)+", "a+b+"];
		for (const re of cases) {
			const result = fixPat(re);
			assert.equal(result.safe, true);
			assert.equal(result.fixed, null);
		}
	});
});

// ── Fix: semanticChange flag ────────────────────────────────────────

describe("Fix; semanticChange flag", () => {
	it("is true when fix is produced", () => {
		for (const re of ["(a+)+", "(a|aa|aaa)+"]) {
			const result = fixPat(re);
			assert.equal(
				result.semanticChange,
				true,
				`Expected ${re} semanticChange:true`,
			);
		}
	});

	it("is false for already-safe input", () => {
		const result = fixPat("[a-z]+");
		assert.equal(result.semanticChange, false);
	});

	it("is false for invalid input", () => {
		const result = fixPat("[abc");
		assert.equal(result.semanticChange, false);
	});

	it("parses empty group () without crashing analysis", () => {
		const result = inspectPat("()");
		assert.equal(result.safe, true);
	});

	it("detects negated SET overlap via CHAR member", () => {
		const result = inspectPat("([^a-z]|[0])+");
		assert.equal(result.safe, false);
		assert.equal(result.hasAlternationReDoS, true);
		assert.equal(result.severity, "high");
	});

	it("detects CHAR vs SET prefix overlap", () => {
		const result = inspectPat("(a|[a-z])+");
		assert.equal(result.safe, false);
		assert.equal(result.hasAlternationReDoS, true);
	});

	it("marks disjoint CHAR vs SET as safe", () => {
		const result = inspectPat("(0|[a-z])+");
		assert.equal(result.safe, true);
	});

	it("handles empty group inside repeated group without crashing", () => {
		// (a())+ triggers getFirstLeaf on an empty group as the second element;
		// empty groups don't contribute to star height, so this is safe
		const result = inspectPat("(a())+");
		assert.equal(result.safe, true);
	});

	it("covers mixed negated SET with RANGE member", () => {
		// ([^a-z]|[0-9])+ exercises setsOverlap with mixed negation + range member
		const result = inspectPat("([^a-z]|[0-9])+");
		assert.equal(result.safe, false);
		assert.equal(result.hasAlternationReDoS, true);
	});

	it("fixes non-same-char alternation (only leading chars)", () => {
		// (ab|ac)+; all alternatives start with 'a' but differ after
		const result = fixPat("(ab|ac)+");
		assert.equal(result.fixed, null); // not auto-fixable
	});

	it("fix; already safe returns null fixed", () => {
		for (const re of ["^[a-z]+$", "(a|b|c)+", "(abc|def)+", "a+b+"]) {
			const result = fixPat(re);
			assert.equal(result.safe, true, `Expected ${re} to be safe`);
			assert.equal(result.fixed, null, `Expected ${re} fixed to be null`);
		}
	});

	it("fix; invalid/unfixable returns null", () => {
		for (const re of ["*Oakland*", "[abc", "abcde(?>hellow)"]) {
			const result = fixPat(re);
			assert.equal(result.fixed, null, `Expected ${re} fixed to be null`);
		}
	});

	it("fix; invalid regex sets safe to false", () => {
		const result = fixPat("[abc");
		assert.equal(result.safe, false);
		assert.equal(result.original, "[abc");
	});

	it("fix; handles disjoint single-token alternatives as already safe", () => {
		// (a+|b+)+ is now recognized as safe (disjoint first chars)
		const result = fixPat("(a+|b+)+");
		assert.equal(result.safe, true);
		assert.equal(result.fixed, null);
	});

	it("fix; general prefix overlap returns null", () => {
		for (const re of ["(ab|abc)+", "(12|123)+", "(cat|cater|caterpillar)+"]) {
			const result = fixPat(re);
			assert.equal(result.fixed, null, `Expected ${re} fixed to be null`);
		}
	});
});

// ── Analyze: edge-case ASTs ────────────────────────────────────────

describe("Analyze; edge-case ASTs", () => {
	it("handles empty root (no branches)", () => {
		const ast: RootNode = { kind: "root", branches: [] };
		const result = analyze(ast);
		assert.equal(result.safe, true);
		assert.equal(result.severity, "none");
		assert.equal(result.starHeight, 0);
		assert.equal(result.repCount, 0);
	});

	it("handles root with empty single branch", () => {
		const ast: RootNode = { kind: "root", branches: [[]] };
		const result = analyze(ast);
		assert.equal(result.safe, true);
		assert.equal(result.severity, "none");
	});

	it("handles root with empty group inside branch", () => {
		const ast: RootNode = {
			kind: "root",
			branches: [[{ kind: "group", capturing: true, branches: [[]] }]],
		};
		const result = analyze(ast);
		assert.equal(result.safe, true);
		assert.equal(result.severity, "none");
	});
});

// ── Analyze: limit boundary values ──────────────────────────────────

describe("Analyze; limit boundary values", () => {
	it("handles limit: 0; flags any repetition", () => {
		// limit 0 means any rep count > 0 triggers
		const result = inspectPat("a+", 0);
		assert.equal(result.safe, false);
		assert.equal(result.repCount, 1);
		// repCount(1) > limit*2(0) → severity high
		assert.equal(result.severity, "high");
	});

	it("handles limit: 1; flags two repetitions", () => {
		const result = inspectPat("a+b+", 1);
		assert.equal(result.safe, false);
		assert.equal(result.repCount, 2);
		assert.equal(result.severity, "low");
	});

	it("handles limit: 1; passes single repetition", () => {
		const result = inspectPat("a+", 1);
		assert.equal(result.safe, true);
		assert.equal(result.repCount, 1);
	});

	it("handles limit: -1; disables limit check", () => {
		const many = Array(100).fill("a?").join("") + Array(100).fill("a").join("");
		const result = inspectPat(many, -1);
		// Sequential overlap should still be detected regardless of limit
		assert.equal(result.hasSequentialOverlap, true);
	});

	it("handles limit: 100; passes within limit", () => {
		const many = Array(27).fill("a?").join("") + Array(27).fill("a").join("");
		const result = inspectPat(many, 100);
		// Sequential overlap makes it unsafe regardless
		assert.equal(result.safe, false);
		assert.equal(result.hasSequentialOverlap, true);
	});
});

// ── Fix: Node input ────────────────────────────────────────────────

describe("Fix; Node input", () => {
	it("accepts AST node (RootNode) as input", () => {
		const ast = tokenize("(a+)+");
		const result = fixRegex(ast);
		assert.equal(result.fixed, "(a+)");
		assert.equal(result.semanticChange, true);
	});

	it("accepts AST node for already-safe pattern", () => {
		const ast = tokenize("^[a-z]+$");
		const result = fixRegex(ast);
		assert.equal(result.safe, true);
		assert.equal(result.fixed, null);
		assert.equal(result.semanticChange, false);
	});

	it("accepts AST node for alternation overlap", () => {
		const ast = tokenize("(a|aa|aaa)+");
		const result = fixRegex(ast);
		assert.equal(result.fixed, "a+");
		assert.equal(result.semanticChange, true);
	});
});

// ── Fix: combined issues ───────────────────────────────────────────

describe("Fix; combined issues", () => {
	it("fixes alternation overlap inside nested repetition", () => {
		const result = fixPat("((a|aa|aaa)+)");
		assert.equal(result.fixed, "(a+)");
	});

	it("does not crash on pattern with multiple issues of different types", () => {
		// Has both alternation overlap and nested repetition
		const result = fixPat("(a|aa|aaa)+(b+)+c");
		// Should strip unnecessary nesting and simplify overlap
		assert.ok(result.fixed !== null || result.safe === false);
	});
});

// ── Analyze: starHeight and repCount verification ───────────────────

describe("Analyze; starHeight and repCount", () => {
	it("reports correct star height for nested repetition", () => {
		const result = inspectPat("(a+)+");
		assert.equal(result.starHeight, 2);
		assert.equal(result.repCount, 2);
	});

	it("reports correct star height for triple nesting", () => {
		const result = inspectPat("(?:(?:a+)+)+");
		assert.equal(result.starHeight, 3);
	});

	it("reports correct star height for safe nested pattern", () => {
		const result = inspectPat("(a+b+)+");
		assert.equal(result.starHeight, 2);
		assert.equal(result.safe, true);
	});

	it("reports star height 0 for no repetitions", () => {
		const result = inspectPat("abc");
		assert.equal(result.starHeight, 0);
		assert.equal(result.repCount, 0);
	});

	it("reports star height 1 for single-level repetition", () => {
		const result = inspectPat("a+");
		assert.equal(result.starHeight, 1);
		assert.equal(result.repCount, 1);
	});
});

// ── Analyze: result structure ──────────────────────────────────────

describe("Analyze; result structure", () => {
	it("safe pattern has fix: null", () => {
		const result = inspectPat("^[a-z]+$");
		assert.equal(result.fix, null);
	});

	it("unsafe pattern has all fields populated", () => {
		const result = inspectPat("(a+)+");
		assert.equal(result.safe, false);
		assert.equal(typeof result.severity, "string");
		assert.ok(Array.isArray(result.reasons));
		assert.equal(typeof result.starHeight, "number");
		assert.equal(typeof result.repCount, "number");
		assert.equal(typeof result.hasAlternationReDoS, "boolean");
		assert.equal(typeof result.hasSequentialOverlap, "boolean");
		assert.equal(typeof result.anchored, "boolean");
		assert.equal(typeof result.hasStaticSuffix, "boolean");
		// fix is null when using analyze directly (inspectPat), string/non-null when using inspect()
		assert.ok(result.fix === null || typeof result.fix === "string");
	});

	it("unsafe pattern without fix has fix: null", () => {
		const result = inspectPat("(ab|abc)+");
		assert.equal(result.safe, false);
		assert.equal(result.fix, null);
	});
});
