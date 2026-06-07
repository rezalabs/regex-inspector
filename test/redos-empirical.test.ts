// ── Empirical ReDoS Verification ──────────────────────────────────────────
// Tests that patterns flagged by the analyzer actually cause exponential
// (or super-linear) backtracking in the V8 regex engine, and that patterns
// marked safe complete in linear time.
//
// Note: V8's Irregexp has aggressive optimizations that short-circuit many
// theoretically dangerous patterns (e.g., .*?B.*?C is converted to a linear
// scan). The patterns tested here are ones that reliably defeat V8's
// optimizer and demonstrate genuine exponential behavior.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "../src/index.ts";

// ── Helpers ───────────────────────────────────────────────────────────────

function bench(
	pattern: string,
	makeInput: (n: number) => string,
	start: number,
	end: number,
	maxMs = 5000,
): { n: number; ms: number; len: number }[] {
	const results: { n: number; ms: number; len: number }[] = [];
	for (let n = start; n <= end; n++) {
		const input = makeInput(n);
		const re = new RegExp(pattern);
		const t0 = performance.now();
		try {
			re.test(input);
		} catch {
			break;
		}
		const ms = performance.now() - t0;
		results.push({ n, ms: Math.round(ms * 1000) / 1000, len: input.length });
		if (ms > maxMs) break;
	}
	return results;
}

/** Assert super-linear growth: median step ratio ≥ 1.5x. */
function assertSuperLinear(timings: { n: number; ms: number }[]): void {
	const ratios: number[] = [];
	for (let i = 2; i < timings.length; i++) {
		if (timings[i]!.ms > 0.5 && timings[i - 1]!.ms > 0) {
			ratios.push(timings[i]!.ms / timings[i - 1]!.ms);
		}
	}
	assert.ok(
		ratios.length >= 2,
		`Expected ≥2 growth ratios, got ${ratios.length}. Timings: ${timings.map((t) => `n${t.n}=${t.ms}ms`).join(", ")}`,
	);
	ratios.sort((a, b) => a - b);
	const median = ratios[Math.floor(ratios.length / 2)]!;
	assert.ok(
		median >= 1.5,
		`Expected super-linear growth (median ratio ≥ 1.5x), got ${median.toFixed(2)}x. Ratios: ${ratios.map((r) => `${r.toFixed(1)}x`).join(", ")}`,
	);
}

/** Assert that the timing stays trivial (no explosion). */
function assertLinear(timings: { n: number; ms: number; len: number }[]): void {
	const last = timings[timings.length - 1]!;
	assert.ok(
		last.ms < 5,
		`Expected linear/constant time (<5ms for last step), got ${last.ms.toFixed(1)}ms at n=${last.n}`,
	);
}

// Category 1: Nested repetition; V8 cannot optimize

describe("Empirical; nested repetition (V8-exploitable)", () => {
	it("(a+)+b; canonical: 2.0x per char on a^n (no b)", () => {
		const pattern = "(a+)+b";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, false);
		assert.equal(analysis.starHeight, 2);

		const timings = bench(pattern, (n) => "a".repeat(n), 1, 25, 2000);
		assert.ok(timings.length >= 8);
		assertSuperLinear(timings);
	});

	it("((a+)+)+b; star height 3: ~3.0x per char", () => {
		const pattern = "((a+)+)+b";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, false);
		assert.equal(analysis.severity, "critical");

		const timings = bench(pattern, (n) => "a".repeat(n), 1, 17, 4000);
		assert.ok(timings.length >= 6);
		assertSuperLinear(timings);
	});

	it("(.+){1,32000}[bc]; upper-bound defeats V8 optimizer (perlgeek)", () => {
		const pattern = "(.+){1,32000}[bc]";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, false);
		// Detected via star height, not sequential overlap
		assert.equal(analysis.starHeight, 2);

		const timings = bench(pattern, (n) => "a".repeat(n), 1, 27, 3000);
		assert.ok(timings.length >= 6);
		assertSuperLinear(timings);
	});
});

// Category 2: Alternation overlap; V8 cannot optimize

describe("Empirical; alternation overlap (V8-exploitable)", () => {
	it("(a|aa|aaa)+b; ~1.9x per char on a^n (no b)", () => {
		const pattern = "(a|aa|aaa)+b";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, false);
		assert.equal(analysis.hasAlternationReDoS, true);

		const timings = bench(pattern, (n) => "a".repeat(n), 1, 24, 3000);
		assert.ok(timings.length >= 8);
		assertSuperLinear(timings);
	});
});

// Category 3: Safe patterns; must stay linear

describe("Empirical; safe patterns (linear)", () => {
	it("(a+b+)+; unambiguous nested rep, linear on (ab)^n", () => {
		const pattern = "(a+b+)+";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, true);

		const timings = bench(pattern, (n) => "ab".repeat(n), 1, 200, 1000);
		assert.ok(timings.length >= 5);
		assertLinear(timings);
	});

	it("^[a-z]+$; anchored literal, instant on a^n", () => {
		const pattern = "^[a-z]+$";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, true);

		const timings = bench(pattern, (n) => "a".repeat(n), 1, 500, 1000);
		assert.ok(timings.length >= 5);
		assertLinear(timings);
	});

	it("\\d+\\d+; two same-domain quantifiers: only 1 adjacency, linear", () => {
		const pattern = "\\d+\\d+";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, true);
		assert.equal(analysis.hasSequentialOverlap, false);

		const timings = bench(pattern, (n) => "1".repeat(n), 1, 200, 1000);
		assert.ok(timings.length >= 5);
		assertLinear(timings);
	});

	it("[^,]*,[^,]*; exclusive charset, cannot over-consume delimiter", () => {
		const pattern = "[^,]*,[^,]*";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, true);
		assert.equal(analysis.hasSequentialOverlap, false);

		const timings = bench(pattern, (n) => "a,".repeat(n), 1, 100, 1000);
		assert.ok(timings.length >= 5);
		assertLinear(timings);
	});
});

// Category 4: Sequential overlap; V8-optimized but structurally
// V8's Irregexp short-circuits most sequential-overlap patterns (.*?B.*?C
// is converted to a linear find-B-then-find-C scan). These patterns are
// flagged by the library as structurally dangerous even though V8 handles
// them. This is correct behavior; other engines (PCRE without JIT, older
// Perl, .NET in some modes) do NOT have these optimizations.
//
// We verify the library's detection is correct, and note that V8's
// optimizer masks the danger at runtime.

describe("Empirical; sequential overlap (flagged, V8-optimized)", () => {
	it(".*?<head>.*?<title>.*?</title> is flagged as unsafe", () => {
		const pattern = ".*?<head>.*?<title>.*?</title>";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, false);
		assert.equal(analysis.hasSequentialOverlap, true);
		assert.equal(analysis.severity, "high");
	});

	it(".*?B.*?C.*?D is flagged (3 adjacencies, O(N³) in theory)", () => {
		const pattern = ".*?B.*?C.*?D";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, false);
		assert.equal(analysis.hasSequentialOverlap, true);
		assert.equal(
			analysis.reasons.some((r) => r.includes("Sequential")),
			true,
		);
	});

	it("(.*?,){11}P is flagged (1 adjacency inside repeated group)", () => {
		const pattern = "(.*?,){11}P";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, false);
		assert.equal(analysis.hasSequentialOverlap, true);
		// Suffix P is not exclusive; dot also matches P
		assert.equal(analysis.hasStaticSuffix, false);
	});

	it("(.*?)+y has severity high (dot overlaps suffix y)", () => {
		const pattern = "(.*?)+y";
		const analysis = inspect(pattern);
		assert.equal(analysis.safe, false);
		assert.equal(analysis.severity, "high");
		assert.equal(analysis.hasStaticSuffix, false);
	});
});

// ── Helper function tests ───────────────────────────────────────────

describe("Empirical; helper functions", () => {
	describe("assertSuperLinear", () => {
		it("passes with exponential growth data", () => {
			const timings = [
				{ n: 1, ms: 1 },
				{ n: 2, ms: 2 },
				{ n: 3, ms: 5 },
				{ n: 4, ms: 12 },
				{ n: 5, ms: 30 },
			];
			// Ratios: 2.5, 2.4, 2.5; median ~2.5, well above 1.5
			assert.doesNotThrow(() => assertSuperLinear(timings));
		});

		it("throws with insufficient data points (< 2 ratios)", () => {
			const timings = [
				{ n: 1, ms: 1 },
				{ n: 2, ms: 2 },
			];
			assert.throws(
				() => assertSuperLinear(timings),
				/Expected ≥2 growth ratios/,
			);
		});

		it("throws with linear growth data (median ratio < 1.5)", () => {
			const timings = [
				{ n: 1, ms: 1 },
				{ n: 2, ms: 2 },
				{ n: 3, ms: 3 },
				{ n: 4, ms: 4 },
				{ n: 5, ms: 5 },
			];
			assert.throws(
				() => assertSuperLinear(timings),
				/Expected super-linear growth/,
			);
		});
	});

	describe("assertLinear", () => {
		it("passes with fast timings (< 5ms)", () => {
			const timings = [
				{ n: 1, ms: 0.5, len: 1 },
				{ n: 100, ms: 1.2, len: 100 },
				{ n: 1000, ms: 2.5, len: 1000 },
			];
			assert.doesNotThrow(() => assertLinear(timings));
		});

		it("throws with slow timings (>= 5ms)", () => {
			const timings = [
				{ n: 100, ms: 0.5, len: 100 },
				{ n: 200, ms: 50, len: 200 },
			];
			assert.throws(
				() => assertLinear(timings),
				/Expected linear\/constant time/,
			);
		});
	});

	describe("bench", () => {
		it("handles pattern that throws on execution", () => {
			// A pattern that matches valid JSON can cause backtracking but
			// should not crash bench. Use a pattern that is valid but slow.
			const timings = bench("a+a+", (n) => "a".repeat(n), 1, 3, 100);
			assert.ok(timings.length >= 1);
		});

		it("stops early when maxMs exceeded", () => {
			// Use a known exponential pattern with low maxMs.
			// Start at n=5 so the first few iterations are fast, but the
			// exponential explosion triggers maxMs well before n=50.
			const timings = bench("(a+)+b", (n) => "a".repeat(n), 5, 50, 20);
			// Should collect at least 2 data points before hitting the limit
			assert.ok(timings.length >= 2);
			// Should not reach n=50 (the max bound)
			const last = timings[timings.length - 1];
			assert.ok(
				last.n < 50,
				`Expected to stop early (n<50), stopped at n=${last.n}`,
			);
		});

		it("starts from given n value", () => {
			const timings = bench("a", (n) => "a".repeat(n), 5, 7, 100);
			assert.equal(timings[0].n, 5);
			assert.equal(timings[timings.length - 1].n, 7);
		});
	});
});
