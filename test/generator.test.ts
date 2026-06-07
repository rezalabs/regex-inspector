// ── Generator Tests ───────────────────────────────────────────────────────
// Verifies reconstruction of regex strings from AST nodes (round-trip).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CharSetNode,
	GroupNode,
	Node,
	RepetitionNode,
	RootNode,
} from "../src/ast.ts";
import { generate } from "../src/generator.ts";
import { tokenize } from "../src/parser.ts";

/** Round-trip test helper: tokenize then reconstruct, compare to expected. */
function rt(pattern: string, expected?: string): void {
	const ast = tokenize(pattern);
	const reconstructed = generate(ast);
	if (expected !== undefined) {
		assert.equal(reconstructed, expected);
	} else {
		// Default normalization: shorthand sets use the shorthand form
		const normalized = pattern
			.replace(/\[\^0-9\]/g, "\\D")
			.replace(/\[0-9\]/g, "\\d")
			.replace(/\[\^_a-zA-Z0-9\]/g, "\\W")
			.replace(/\[_a-zA-Z0-9\]/g, "\\w");
		assert.equal(reconstructed, normalized);
	}
}

describe("Generator; round-trip", () => {
	it("reconstructs empty pattern", () => {
		rt("");
	});

	it("reconstructs literal chars", () => {
		rt("a");
		rt("word");
		rt("//");
	});

	it("reconstructs dot", () => {
		rt(".", ".");
	});

	it("reconstructs predefined sets", () => {
		rt("\\d", "\\d");
		rt("\\D", "\\D");
		rt("\\w", "\\w");
		rt("\\W", "\\W");
		rt("\\s", "\\s");
		rt("\\S", "\\S");
	});

	it("reconstructs combined predefined sets", () => {
		rt("\\w\\W\\d\\D\\s\\S.", "\\w\\W\\d\\D\\s\\S.");
	});

	it("reconstructs position anchors", () => {
		rt("^");
		rt("$");
		rt("^a$");
	});

	it("reconstructs word boundaries", () => {
		rt("\\b");
		rt("\\B");
		rt("\\bbeginning\\B");
	});

	it("reconstructs escaped special chars", () => {
		rt("\\.", "\\.");
		rt("\\|", "\\|");
		rt("\\?", "\\?");
		rt("\\(", "\\(");
		rt("\\)", "\\)");
		rt("\\{", "\\{");
		rt("\\}", "\\}");
		rt("\\\\", "\\\\");
		rt("\\$", "\\$");
		rt("\\^", "\\^");
	});

	it("reconstructs character classes", () => {
		rt("[abc]");
		rt("[^abc]");
		rt("[a-z]");
		rt("[$!a-z123]");
	});

	it("reconstructs predefined set inside nested charset", () => {
		// [\\d] tokenizes to a charset containing the digits() preset (another charset node).
		// generate() must render the nested charset member inline (without brackets).
		const ast = tokenize("[\\d]");
		const result = generate(ast);
		// digits() expands to [0-9], but inside a charset the brackets are omitted → 0-9
		assert.equal(result, "[0-9]");
	});

	it("reconstructs full predefined set equivalents as shorthands", () => {
		rt("[0-9]", "\\d");
		rt("[^0-9]", "\\D");
		rt("[_a-zA-Z0-9]", "\\w");
		rt("[^_a-zA-Z0-9]", "\\W");
	});

	it("reconstructs unicode property escapes", () => {
		const ast = tokenize(String.raw`\p{L}`);
		assert.equal(generate(ast), String.raw`\p{L}`);

		const ast2 = tokenize(String.raw`\P{N}`);
		assert.equal(generate(ast2), String.raw`\P{N}`);
	});

	it("reconstructs alternation", () => {
		rt("foo|bar|za");
		rt("(foo|bar|za)");
	});

	it("reconstructs groups", () => {
		rt("(abc)");
		rt("(?:abc)");
		rt("(?=abc)");
		rt("(?!abc)");
		rt("(?<=abc)");
		rt("(?<!abc)");
		rt("(?<year>\\d{4})", "(?<year>\\d{4})");
		rt("(?i:foo)");
		rt("(?-i:foo)");
		rt("(?im-s:foo)");
		rt("(?i)", "(?i)");
	});

	it("reconstructs quantifiers", () => {
		rt("a?", "a?");
		rt("a*", "a*");
		rt("a+", "a+");
		rt("a??", "a??");
		rt("a*?", "a*?");
		rt("a+?", "a+?");
		rt("a{3}", "a{3}");
		rt("a{3,}", "a{3,}");
		rt("a{3,5}", "a{3,5}");
		rt("a{3,5}?", "a{3,5}?");
	});

	it("reconstructs backreferences", () => {
		const ast = tokenize("(a)\\1");
		assert.equal(generate(ast), "(a)\\1");
	});

	it("handles bare root node", () => {
		const root: RootNode = { kind: "root", branches: [[]] };
		assert.equal(generate(root), "");
	});

	it("reconstructs emoji char", () => {
		const ast = tokenize("\\u{1F600}");
		const reconstructed = generate(ast);
		assert.equal(reconstructed, String.fromCodePoint(0x1f600));
	});

	it("throws on unknown token", () => {
		assert.throws(
			() => generate({ kind: "nonexistent" } as any),
			/Unknown token kind/,
		);
	});

	it("throws on unknown set member kind", () => {
		const ast: Node = {
			kind: "root",
			branches: [
				[
					{
						kind: "charset",
						negated: false,
						members: [{ kind: "invalid" as any, value: 0 }],
					},
				],
			],
		};
		assert.throws(() => generate(ast), /Unknown set member kind/);
	});

	it("reconstructs complex escaped char combos", () => {
		// \[ stays escaped, \] normalizes to bare ]
		assert.equal(
			generate(tokenize(String.raw`\$\^\[\]\.\|`)),
			String.raw`\$\^\[]\.\|`,
		);
		assert.equal(
			generate(tokenize(String.raw`$\^\[\]\.\|`)),
			String.raw`$\^\[]\.\|`,
		);
		assert.equal(
			generate(tokenize(String.raw`\$^\[\]\.\|`)),
			String.raw`\$^\[]\.\|`,
		);
		assert.equal(
			generate(tokenize(String.raw`\$\^[]\.\|`)),
			String.raw`\$\^[]\.\|`,
		);
		assert.equal(
			generate(tokenize(String.raw`\$\^\[\].\|`)),
			String.raw`\$\^\[].\|`,
		);
		assert.equal(
			generate(tokenize(String.raw`\$\^\[\]\.|\\`)),
			String.raw`\$\^\[]\.|\\`,
		);
	});

	it("reconstructs negated single-char classes", () => {
		rt("[^.]");
		rt("[^test]");
	});

	it("reconstructs whitespace in class", () => {
		rt("[\t\r\n\u2028\u2029 ]");
	});

	it("reconstructs two sets with dash between", () => {
		rt("[01]-[ab]");
	});

	it("reconstructs lookarounds", () => {
		rt("(?<=a)b");
		rt("(?<=text)");
		rt("(?<!a)b");
		rt("(?<!text)");
		rt("(?<!ab{2,4}c{3,5}d)test");
	});

	it("reconstructs \\u{10FFFF} max codepoint", () => {
		const ast = tokenize("\\u{10FFFF}");
		assert.equal(generate(ast), String.fromCodePoint(0x10ffff));
	});

	it("reconstructs reference pattern", () => {
		rt("<(\\w+)>\\w*<\\1>");
	});
});

// ── Low-level reconstruction tests ──────────────────────────────────

describe("Generator; low-level", () => {
	it("reconstructs bare REPETITION token", () => {
		const rep: RepetitionNode = {
			kind: "repetition",
			min: 2,
			max: 4,
			greedy: true,
			child: { kind: "char", value: 97 },
		};
		assert.equal(generate(rep), "a{2,4}");
	});

	it("reconstructs bare CHARSET token", () => {
		const set: CharSetNode = {
			kind: "charset",
			negated: false,
			members: [
				{ kind: "char", value: 97 },
				{ kind: "range", from: 48, to: 57 },
			],
		};
		assert.equal(generate(set), "[a0-9]");
	});

	it("reconstructs bare GROUP token", () => {
		const group: GroupNode = {
			kind: "group",
			capturing: true,
			branches: [[{ kind: "char", value: 120 }]],
		};
		assert.equal(generate(group), "(x)");
	});

	it("reconstructs set with escaped chars inside", () => {
		// [a\\--\\-]; range from hyphen to hyphen
		const ast = tokenize("[a\\--\\-]");
		const reconstructed = generate(ast);
		assert.equal(reconstructed, "[a\\--\\-]");
	});

	it("reconstructs set with caret range [9-\\^]", () => {
		const ast = tokenize("[9-\\^]");
		const reconstructed = generate(ast);
		assert.equal(reconstructed, "[9-\\^]");
	});

	it("reconstructs set with closing bracket range [2-\\]]", () => {
		const ast = tokenize("[2-\\]]");
		const reconstructed = generate(ast);
		assert.equal(reconstructed, "[2-\\]]");
	});
});

// ── Low-level: advanced node types ────────────────────────────────

describe("Generator; low-level advanced", () => {
	it("reconstructs root with multiple branches (top-level alternation)", () => {
		const root: RootNode = {
			kind: "root",
			branches: [[{ kind: "char", value: 97 }], [{ kind: "char", value: 98 }]],
		};
		assert.equal(generate(root), "a|b");
	});

	it("reconstructs group with multiple branches", () => {
		const group: GroupNode = {
			kind: "group",
			capturing: true,
			branches: [
				[{ kind: "char", value: 120 }],
				[{ kind: "char", value: 121 }],
			],
		};
		assert.equal(generate(group), "(x|y)");
	});

	it("reconstructs repetition with Infinity max", () => {
		const rep: RepetitionNode = {
			kind: "repetition",
			min: 3,
			max: Infinity,
			greedy: true,
			child: { kind: "char", value: 97 },
		};
		assert.equal(generate(rep), "a{3,}");
	});

	it("reconstructs repetition with Infinity max greedy false", () => {
		const rep: RepetitionNode = {
			kind: "repetition",
			min: 3,
			max: Infinity,
			greedy: false,
			child: { kind: "char", value: 97 },
		};
		assert.equal(generate(rep), "a{3,}?");
	});

	it("reconstructs negated charset", () => {
		const set: CharSetNode = {
			kind: "charset",
			negated: true,
			members: [
				{ kind: "char", value: 97 },
				{ kind: "range", from: 48, to: 57 },
			],
		};
		assert.equal(generate(set), "[^a0-9]");
	});

	it("reconstructs backreference node", () => {
		const ref: BackreferenceNode = { kind: "backreference", index: 3 };
		assert.equal(generate(ref), "\\3");
	});

	it("reconstructs position anchor ^", () => {
		const pos: PositionNode = { kind: "position", value: "^" };
		assert.equal(generate(pos), "^");
	});

	it("reconstructs position anchor $", () => {
		const pos: PositionNode = { kind: "position", value: "$" };
		assert.equal(generate(pos), "$");
	});

	it("reconstructs position anchor \\b", () => {
		const pos: PositionNode = { kind: "position", value: "b" };
		assert.equal(generate(pos), "\\b");
	});

	it("reconstructs position anchor \\B", () => {
		const pos: PositionNode = { kind: "position", value: "B" };
		assert.equal(generate(pos), "\\B");
	});

	it("reconstructs unicode_property node \\p{L}", () => {
		const prop: UnicodePropertyNode = {
			kind: "unicode_property",
			property: "L",
			negated: false,
		};
		assert.equal(generate(prop), "\\p{L}");
	});

	it("reconstructs unicode_property node \\P{N}", () => {
		const prop: UnicodePropertyNode = {
			kind: "unicode_property",
			property: "N",
			negated: true,
		};
		assert.equal(generate(prop), "\\P{N}");
	});

	it("reconstructs deeply nested structure (3 levels)", () => {
		const innerA: RepetitionNode = {
			kind: "repetition",
			min: 1,
			max: Infinity,
			greedy: true,
			child: { kind: "char", value: 97 },
		};
		const innerB: RepetitionNode = {
			kind: "repetition",
			min: 1,
			max: Infinity,
			greedy: true,
			child: { kind: "char", value: 98 },
		};
		const outerGroup: GroupNode = {
			kind: "group",
			capturing: true,
			branches: [
				[
					{
						kind: "repetition",
						min: 0,
						max: Infinity,
						greedy: true,
						child: {
							kind: "group",
							capturing: true,
							branches: [[innerA], [innerB]],
						},
					},
					{ kind: "char", value: 99 },
				],
			],
		};
		const rep: RepetitionNode = {
			kind: "repetition",
			min: 1,
			max: Infinity,
			greedy: true,
			child: outerGroup,
		};
		const root: RootNode = { kind: "root", branches: [[rep]] };
		const result = generate(root);
		assert.equal(result, "((a+|b+)*c)+");
	});
});
