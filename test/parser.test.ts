// ── Parser Tests ─────────────────────────────────────────────────────────
// Verifies that the tokenizer correctly parses regex patterns into ASTs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CharSetNode,
	GroupNode,
	RepetitionNode,
	RootNode,
	Token,
} from "../src/ast.ts";
import { generate } from "../src/generator.ts";
import { tokenize } from "../src/parser.ts";
import { digits, dot, whitespace, wordChars } from "../src/preset.ts";

const char = (s: string): Token => ({
	kind: "char" as const,
	value: s.codePointAt(0)!,
});
const charStr = (s: string): Token[] => [...s].map(char);

// ── Basic tokens ────────────────────────────────────────────────────

describe("Parser; basic tokens", () => {
	it("parses literal characters", () => {
		const ast = tokenize("walnuts");
		assert.deepEqual(ast, {
			kind: "root",
			branches: [charStr("walnuts")],
		} satisfies RootNode);
	});

	it("parses empty pattern", () => {
		const ast = tokenize("");
		assert.deepEqual(ast, {
			kind: "root",
			branches: [[]],
		} satisfies RootNode);
	});

	it("parses position anchors ^ and $", () => {
		const ast = tokenize("^yes$");
		assert.equal(ast.branches[0].length, 5);
		assert.deepEqual(ast.branches[0][0], { kind: "position", value: "^" });
		assert.deepEqual(ast.branches[0][4], { kind: "position", value: "$" });
	});

	it("parses word boundaries \\b and \\B", () => {
		const ast = tokenize("\\bbeginning\\B");
		assert.deepEqual(ast.branches[0][0], { kind: "position", value: "b" });
		assert.deepEqual(ast.branches[0][10], { kind: "position", value: "B" });
	});

	it("parses dot as negated line-terminator set", () => {
		const ast = tokenize(".");
		assert.deepEqual(ast.branches[0][0], dot());
	});
});

// ── Predefined sets ─────────────────────────────────────────────────

describe("Parser; predefined sets", () => {
	it("parses \\d and \\D", () => {
		const ast = tokenize("\\d\\D");
		assert.deepEqual(ast.branches[0][0], digits());
		assert.deepEqual(ast.branches[0][1], { ...digits(), negated: true });
	});

	it("parses \\w and \\W", () => {
		const ast = tokenize("\\w\\W");
		assert.deepEqual(ast.branches[0][0], wordChars());
		assert.deepEqual(ast.branches[0][1], { ...wordChars(), negated: true });
	});

	it("parses \\s and \\S", () => {
		const ast = tokenize("\\s\\S");
		assert.deepEqual(ast.branches[0][0], whitespace());
		assert.deepEqual(ast.branches[0][1], { ...whitespace(), negated: true });
	});
});

// ── Character classes ───────────────────────────────────────────────

describe("Parser; character classes", () => {
	it("parses simple class [abc]", () => {
		const ast = tokenize("[abc]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.kind, "charset");
		assert.equal(set.negated, false);
		assert.equal(set.members.length, 3);
		assert.deepEqual(set.members[0], { kind: "char", value: 97 });
	});

	it("parses negated class [^abc]", () => {
		const ast = tokenize("[^abc]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.negated, true);
		assert.equal(set.members.length, 3);
	});

	it("parses range [a-z]", () => {
		const ast = tokenize("[a-z]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.deepEqual(set.members[0], { kind: "range", from: 97, to: 122 });
	});

	it("parses mixed class [$!a-z123]", () => {
		const ast = tokenize("[$!a-z123]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 6);
		assert.deepEqual(set.members[0], { kind: "char", value: 36 }); // $
		assert.deepEqual(set.members[2], { kind: "range", from: 97, to: 122 }); // a-z
	});

	it("parses predefined sets inside class [\\w\\d\\s]", () => {
		const ast = tokenize("[\\w\\d\\s]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.deepEqual(set.members[0], wordChars());
		assert.deepEqual(set.members[1], digits());
		assert.deepEqual(set.members[2], whitespace());
	});

	it("parses negated predefined sets inside class [\\W\\D\\S]", () => {
		const ast = tokenize("[\\W\\D\\S]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.deepEqual(set.members[0], { ...wordChars(), negated: true });
		assert.deepEqual(set.members[1], { ...digits(), negated: true });
		assert.deepEqual(set.members[2], { ...whitespace(), negated: true });
	});

	it("parses empty set []", () => {
		const ast = tokenize("[]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.negated, false);
		assert.equal(set.members.length, 0);
	});

	it("parses empty negated set [^]", () => {
		const ast = tokenize("[^]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.negated, true);
		assert.equal(set.members.length, 0);
	});

	it("parses dash at start [-a]", () => {
		const ast = tokenize("[-a]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 2);
		assert.deepEqual(set.members[0], { kind: "char", value: 45 }); // -
		assert.deepEqual(set.members[1], { kind: "char", value: 97 }); // a
	});

	it("parses dash at end [a-]", () => {
		const ast = tokenize("[a-]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 2);
		assert.deepEqual(set.members[0], { kind: "char", value: 97 }); // a
		assert.deepEqual(set.members[1], { kind: "char", value: 45 }); // -
	});

	it("parses escaped hyphen [a\\-z]", () => {
		const ast = tokenize("[a\\-z]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 3);
		assert.deepEqual(set.members[0], { kind: "char", value: 97 }); // a
		assert.deepEqual(set.members[1], { kind: "char", value: 45 }); // - (escaped)
		assert.deepEqual(set.members[2], { kind: "char", value: 122 }); // z
	});

	describe("character class hyphen-range edge cases", () => {
		const rt = (pat: string, expected?: string) => {
			const ast = tokenize(pat);
			const reconstructed = generate(ast);
			assert.equal(reconstructed, expected ?? pat);
		};

		it("[a\\--\\-] range from hyphen to hyphen", () => rt("[a\\--\\-]"));
		it("[a\\--/] range from hyphen to /", () => rt("[a\\--/]"));
		it("[c\\--a] range from hyphen to a", () => rt("[c\\--a]"));
		it("[\\-\\--\\-] all hyphens", () => rt("[\\-\\--\\-]"));
		it("[\\w\\--\\-] predefined set + hyphen range", () =>
			rt("[\\w\\--\\-]", "[_a-zA-Z0-9\\--\\-]"));
		it("[9-\\^] range to caret", () => rt("[9-\\^]"));
		it("[2-\\]] range to bracket", () => rt("[2-\\]]"));
		it("[\\]-\\^] bracket to caret", () => rt("[\\]-\\^]"));
		it("[[-\\]] bracket to bracket", () => rt("[[-\\]]", "[[-\\]]"));
		it("[[-]] literal bracket + close", () => rt("[[-]]", "[[\\-]]"));
		it("[\\^-_] caret to underscore", () => rt("[\\^-_]"));
		it("[^\\^-_] negated caret to underscore", () => rt("[^\\^-_]"));
		it("[\\^-^] caret to caret", () => rt("[\\^-^]", "[\\^-\\^]"));
		it("[^\\^-^] negated caret to caret", () => rt("[^\\^-^]", "[^\\^-\\^]"));
	});

	// Explicit AST structure tests for range edge cases
	it("[a\\--\\-] has char a + range 45-45", () => {
		const ast = tokenize("[a\\--\\-]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 2);
		assert.deepEqual(set.members[0], { kind: "char", value: 97 });
		assert.deepEqual(set.members[1], { kind: "range", from: 45, to: 45 });
	});

	it("[a\\--/] has char a + range 45-47", () => {
		const ast = tokenize("[a\\--/]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 2);
		assert.deepEqual(set.members[0], { kind: "char", value: 97 });
		assert.deepEqual(set.members[1], { kind: "range", from: 45, to: 47 });
	});

	it("[c\\--a] has char c + range 45-97", () => {
		const ast = tokenize("[c\\--a]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 2);
		assert.deepEqual(set.members[0], { kind: "char", value: 99 });
		assert.deepEqual(set.members[1], { kind: "range", from: 45, to: 97 });
	});

	it("[9-\\^] has range 57-94", () => {
		const ast = tokenize("[9-\\^]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 1);
		assert.deepEqual(set.members[0], { kind: "range", from: 57, to: 94 });
	});

	it("[2-\\]] has range 50-93", () => {
		const ast = tokenize("[2-\\]]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 1);
		assert.deepEqual(set.members[0], { kind: "range", from: 50, to: 93 });
	});

	it("[\\]-\\^] has range 93-94", () => {
		const ast = tokenize("[\\]-\\^]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 1);
		assert.deepEqual(set.members[0], { kind: "range", from: 93, to: 94 });
	});

	it("[[-\\]] has range 91-93", () => {
		const ast = tokenize("[[-\\]]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 1);
		assert.deepEqual(set.members[0], { kind: "range", from: 91, to: 93 });
	});

	it("[]  is empty set", () => {
		const ast = tokenize("[]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.negated, false);
		assert.equal(set.members.length, 0);
	});

	it("[^] is empty negated set", () => {
		const ast = tokenize("[^]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.negated, true);
		assert.equal(set.members.length, 0);
	});

	it("parses whitespace chars in class", () => {
		const ast = tokenize("[\t\r\n\u2028\u2029 ]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 6);
		assert.deepEqual(set.members[0], { kind: "char", value: 9 }); // \t
		assert.deepEqual(set.members[1], { kind: "char", value: 13 }); // \r
		assert.deepEqual(set.members[2], { kind: "char", value: 10 }); // \n
		assert.deepEqual(set.members[3], { kind: "char", value: 0x2028 });
		assert.deepEqual(set.members[4], { kind: "char", value: 0x2029 });
		assert.deepEqual(set.members[5], { kind: "char", value: 32 }); // space
	});

	it("parses \\u{1F600} inside character class", () => {
		const ast = tokenize("[\\u{1F600}]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 2); // surrogate pair
		assert.deepEqual(set.members[0], { kind: "char", value: 0xd83d });
		assert.deepEqual(set.members[1], { kind: "char", value: 0xde00 });
	});

	it("parses \\p{L} inside class", () => {
		const ast = tokenize("[\\p{L}]");
		const set = ast.branches[0][0] as CharSetNode;
		assert.deepEqual(set.members[0], {
			kind: "unicode_property",
			property: "L",
			negated: false,
		});
	});

	it("parses \\q{abc} inside class", () => {
		const ast = tokenize(String.raw`[\q{abc}]`);
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 1);
		assert.equal(set.members[0]!.kind, "string_member");
		if (set.members[0]!.kind === "string_member") {
			assert.equal(set.members[0]!.strings.length, 1);
			assert.deepEqual(set.members[0]!.strings[0], [97, 98, 99]);
		}
	});

	it("throws on unterminated class", () => {
		assert.throws(() => tokenize("[abc"), /Unterminated character class/);
	});

	it("throws on range out of order [z-a]", () => {
		assert.throws(() => tokenize("[z-a]"), /Range out of order/);
	});
});

// ── v-mode set operations ──────────────────────────────────────────

describe("Parser; v-mode set operations", () => {
	const rt = (pat: string, expected?: string) => {
		const ast = tokenize(pat);
		const reconstructed = generate(ast);
		assert.equal(reconstructed, expected ?? pat);
	};

	it("parses subtraction [a-z--[ab]]", () => {
		rt("[a-z--[ab]]", "[[a-z]--[ab]]");
	});

	it("parses intersection [a-z&&[ab]]", () => {
		rt("[a-z&&[ab]]", "[[a-z]&&[ab]]");
	});

	it("parses left-associative subtraction [a--b--c]", () => {
		rt("[a--b--c]", "[[a--b]--c]");
	});

	it("parses left-associative intersection [a&&b&&c]", () => {
		rt("[a&&b&&c]", "[[a&&b]&&c]");
	});

	it("intersection binds tighter [a--b&&c]", () => {
		rt("[a--b&&c]", "[a--[b&&c]]");
	});

	it("mixed set ops [a&&b--c]", () => {
		rt("[a&&b--c]", "[[a&&b]--c]");
	});

	it("shorthand with subtraction [\\w--[abc]]", () => {
		const ast = tokenize(String.raw`[\w--[abc]]`);
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 1);
		const op = set.members[0]!;
		assert.equal(op.kind, "set_op");
		if (op.kind === "set_op") {
			assert.equal(op.operator, "subtract");
			assert.equal(op.left.kind, "charset");
		}
	});

	it("shorthand with intersection [\\d&&[0-5]]", () => {
		const ast = tokenize(String.raw`[\d&&[0-5]]`);
		const set = ast.branches[0][0] as CharSetNode;
		const op = set.members[0]!;
		assert.equal(op.kind, "set_op");
		if (op.kind === "set_op") {
			assert.equal(op.operator, "intersect");
		}
	});

	it("range with subtraction [a-z--\\q{abc}]", () => {
		rt(String.raw`[a-z--\q{abc}]`, String.raw`[[a-z]--\q{abc}]`);
	});

	it("does not treat single hyphen as set op", () => {
		// Generator always escapes hyphens inside classes (pre-existing normalization)
		rt("[-a]", "[\\-a]");
		rt("[a-]", "[a\\-]");
		rt(String.raw`[a\-z]`);
	});
});

// ── v-mode set operation validation ────────────────────────────────

describe("Parser; malformed set operations", () => {
	it("throws on leading operator", () => {
		assert.throws(() => tokenize("[--a]"), /Invalid set operation/);
		assert.throws(() => tokenize("[&&a]"), /Invalid set operation/);
	});

	it("throws on trailing operator", () => {
		assert.throws(() => tokenize("[a--]"), /Invalid set operation/);
		assert.throws(() => tokenize("[a&&]"), /Invalid set operation/);
	});

	it("throws on adjacent operators", () => {
		assert.throws(() => tokenize("[a&&--b]"), /Invalid set operation/);
		assert.throws(() => tokenize("[a--&&b]"), /Invalid set operation/);
	});

	it("still parses a literal single & as a plain member", () => {
		// [a&&&b]: the double && is an operator, the third & is a literal.
		const ast = tokenize("[a&&&b]");
		const set = ast.branches[0][0] as CharSetNode;
		const op = set.members[0]!;
		assert.equal(op.kind, "set_op");
		if (op.kind === "set_op") {
			assert.equal(op.operator, "intersect");
			assert.equal(op.right.kind, "char");
		}
	});
});

// ── v-mode string members ───────────────────────────────────────────

describe("Parser; v-mode string members", () => {
	const rt = (pat: string, expected?: string) => {
		const ast = tokenize(pat);
		const reconstructed = generate(ast);
		assert.equal(reconstructed, expected ?? pat);
	};

	it("parses single string \\q{abc}", () => {
		rt(String.raw`[\q{abc}]`);
	});

	it("parses \\q{abc|def} with alternation", () => {
		rt(String.raw`[\q{abc|def}]`);
	});

	it("parses \\q{a|b|c} with multiple alternatives", () => {
		rt(String.raw`[\q{a|b|c}]`);
	});

	it("creates StringMemberNode for multi-alternative \\q{}", () => {
		const ast = tokenize(String.raw`[\q{abc|def}]`);
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 1);
		const m = set.members[0]!;
		assert.equal(m.kind, "string_member");
		if (m.kind === "string_member") {
			assert.equal(m.strings.length, 2);
			assert.deepEqual(m.strings[0], [97, 98, 99]);
			assert.deepEqual(m.strings[1], [100, 101, 102]);
		}
	});

	it("creates StringMemberNode for single-string \\q{}", () => {
		const ast = tokenize(String.raw`[\q{abc}]`);
		const set = ast.branches[0][0] as CharSetNode;
		assert.equal(set.members.length, 1);
		const m = set.members[0]!;
		assert.equal(m.kind, "string_member");
	});

	it("trailing pipe in \\q{} is ignored", () => {
		rt(String.raw`[\q{a|}]`, String.raw`[\q{a}]`);
	});
});

// ── v-mode semantics verification (real V8 RegExp) ────────────────

describe("Parser; v-mode RegExp semantics", () => {
	/** Round-trip through parser→generator, then create v-flag RegExp. */
	function vre(pattern: string): RegExp {
		return new RegExp(generate(tokenize(pattern)), "v");
	}

	it("subtraction produces correct matches", () => {
		const re = vre("[a-z--[ab]]");
		assert.ok(re.test("c"));
		assert.ok(re.test("z"));
		assert.ok(!re.test("a"));
		assert.ok(!re.test("b"));
	});

	it("intersection produces correct matches", () => {
		const re = vre("[a-z&&[aeiou]]");
		assert.ok(re.test("a"));
		assert.ok(re.test("e"));
		assert.ok(!re.test("b"));
		assert.ok(!re.test("z"));
	});

	it("string member preserves multi-char semantics", () => {
		const re = vre(String.raw`[\q{abc}]`);
		assert.ok(re.test("abc"));
		assert.ok(!re.test("a"));
	});

	it("left-associative subtraction", () => {
		const re = vre("[a--b--c]");
		assert.ok(re.test("a"));
		assert.ok(!re.test("b"));
	});

	it("precedence: && before --", () => {
		const re = vre("[a--b&&c]");
		assert.ok(re.test("a"));
		assert.ok(!re.test("b"));
	});

	it("full anchored pattern works", () => {
		const re = vre("^[a-z--[ab]]+$");
		assert.ok(re.test("hello"));
		assert.ok(!re.test("ab"));
	});
});

// ── Groups ──────────────────────────────────────────────────────────

describe("Parser; groups", () => {
	it("parses capturing group (abc)", () => {
		const ast = tokenize("(abc)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.kind, "group");
		assert.equal(g.capturing, true);
		assert.equal(g.branches.length, 1);
		assert.equal(g.branches[0].length, 3);
	});

	it("parses non-capturing group (?:abc)", () => {
		const ast = tokenize("(?:abc)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.capturing, false);
		assert.equal(g.lookahead, undefined);
	});

	it("parses positive lookahead (?=abc)", () => {
		const ast = tokenize("(?=abc)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.capturing, false);
		assert.equal(g.lookahead, true);
	});

	it("parses negative lookahead (?!abc)", () => {
		const ast = tokenize("(?!abc)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.negatedLookahead, true);
	});

	it("parses positive lookbehind (?<=abc)", () => {
		const ast = tokenize("(?<=abc)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.lookbehind, true);
	});

	it("parses negative lookbehind (?<!abc)", () => {
		const ast = tokenize("(?<!abc)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.negatedLookbehind, true);
	});

	it("parses named capturing group (?<year>\\d{4})", () => {
		const ast = tokenize("(?<year>\\d{4})");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.capturing, true);
		assert.equal(g.name, "year");
	});

	it("throws on duplicate capture group name", () => {
		assert.throws(
			() => tokenize("(?<a>.)(?<a>.)"),
			/Duplicate capture group name/,
		);
	});

	it("parses modifier group (?i:foo)", () => {
		const ast = tokenize("(?i:foo)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.capturing, false);
		assert.equal(g.modifiers, "i");
	});

	it("parses multi-flag modifier group (?im-s:foo)", () => {
		const ast = tokenize("(?im-s:foo)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.modifiers, "im-s");
	});

	it("parses standalone modifier (?i)", () => {
		const ast = tokenize("(?i)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.modifiers, "i");
		assert.equal(g.branches[0].length, 0);
	});

	it("throws on unmatched )", () => {
		assert.throws(() => tokenize(")"), /Unmatched \)/);
	});

	it("throws on unterminated group", () => {
		assert.throws(() => tokenize("(abc"), /Unterminated group/);
	});
});

// ── Alternation ─────────────────────────────────────────────────────

describe("Parser; alternation", () => {
	it("parses foo|bar|za", () => {
		const ast = tokenize("foo|bar|za");
		assert.equal(ast.branches.length, 3);
		assert.deepEqual(ast.branches[0], charStr("foo"));
		assert.deepEqual(ast.branches[1], charStr("bar"));
		assert.deepEqual(ast.branches[2], charStr("za"));
	});

	it("parses alternation inside group (foo|bar)", () => {
		const ast = tokenize("(foo|bar)");
		const g = ast.branches[0][0] as GroupNode;
		assert.equal(g.branches.length, 2);
		assert.deepEqual(g.branches[0], charStr("foo"));
		assert.deepEqual(g.branches[1], charStr("bar"));
	});

	it("parses nested alternation a(b|c|(?:d))fg", () => {
		const ast = tokenize("a(b|c|(?:d))fg");
		assert.equal(ast.branches[0].length, 4); // a, group, f, g
		const g = ast.branches[0][1] as GroupNode;
		assert.equal(g.branches.length, 3);
	});
});

// ── Quantifiers ─────────────────────────────────────────────────────

describe("Parser; quantifiers", () => {
	it("parses ? (optional)", () => {
		const ast = tokenize("a?");
		const rep = ast.branches[0][0] as RepetitionNode;
		assert.equal(rep.kind, "repetition");
		assert.equal(rep.min, 0);
		assert.equal(rep.max, 1);
		assert.equal(rep.greedy, true);
		assert.deepEqual(rep.child, char("a"));
	});

	it("parses * (zero or more)", () => {
		const ast = tokenize("a*");
		const rep = ast.branches[0][0] as RepetitionNode;
		assert.equal(rep.min, 0);
		assert.equal(rep.max, Infinity);
	});

	it("parses + (one or more)", () => {
		const ast = tokenize("a+");
		const rep = ast.branches[0][0] as RepetitionNode;
		assert.equal(rep.min, 1);
		assert.equal(rep.max, Infinity);
	});

	it("parses {n}", () => {
		const ast = tokenize("a{3}");
		const rep = ast.branches[0][0] as RepetitionNode;
		assert.equal(rep.min, 3);
		assert.equal(rep.max, 3);
	});

	it("parses {n,}", () => {
		const ast = tokenize("a{3,}");
		const rep = ast.branches[0][0] as RepetitionNode;
		assert.equal(rep.min, 3);
		assert.equal(rep.max, Infinity);
	});

	it("parses {n,m}", () => {
		const ast = tokenize("a{3,5}");
		const rep = ast.branches[0][0] as RepetitionNode;
		assert.equal(rep.min, 3);
		assert.equal(rep.max, 5);
	});

	it("parses lazy quantifiers", () => {
		const cases = ["a??", "a*?", "a+?", "a{3,5}?"] as const;
		for (const c of cases) {
			const ast = tokenize(c);
			const rep = ast.branches[0][0] as RepetitionNode;
			assert.equal(rep.greedy, false, `Expected ${c} to be lazy`);
		}
	});

	it("rejects sequential quantifiers a++", () => {
		assert.throws(() => tokenize("a++"), /Nothing to repeat/);
	});

	it("treats a{mustache} as literal braces", () => {
		const ast = tokenize("a{mustache}");
		assert.equal(ast.branches[0].length, "a{mustache}".length);
		for (const tok of ast.branches[0]) {
			assert.equal(tok.kind, "char");
		}
	});

	it("throws on numbers out of order {5,3}", () => {
		assert.throws(() => tokenize("a{5,3}"), /Numbers out of order/);
	});

	it("throws on nothing to repeat at start", () => {
		assert.throws(() => tokenize("+"), /Nothing to repeat/);
	});
});

// ── Unicode property escapes ────────────────────────────────────────

describe("Parser; unicode property escapes", () => {
	it("parses \\p{L}", () => {
		const ast = tokenize(String.raw`\p{L}`);
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "unicode_property");
		if (tok.kind === "unicode_property") {
			assert.equal(tok.property, "L");
			assert.equal(tok.negated, false);
		}
	});

	it("parses \\P{N}", () => {
		const ast = tokenize(String.raw`\P{N}`);
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "unicode_property");
		if (tok.kind === "unicode_property") {
			assert.equal(tok.property, "N");
			assert.equal(tok.negated, true);
		}
	});

	it("preserves property=value syntax", () => {
		const ast = tokenize(String.raw`\p{Script=Latin}`);
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "unicode_property");
		if (tok.kind === "unicode_property") {
			assert.equal(tok.property, "Script=Latin");
		}
	});
});

// ── Backreferences ──────────────────────────────────────────────────

describe("Parser; backreferences", () => {
	it("parses \\1 as backreference when group exists", () => {
		const ast = tokenize("(a)\\1");
		const ref = ast.branches[0][1];
		assert.equal(ref.kind, "backreference");
		if (ref.kind === "backreference") {
			assert.equal(ref.index, 1);
		}
	});

	it("downgrades \\1 to char when no groups", () => {
		const ast = tokenize("\\1");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") {
			assert.equal(tok.value, 1);
		}
	});

	it("downgrades \\2 to char when no groups", () => {
		const ast = tokenize("\\2");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 2);
	});

	it("parses \\10 as backreference with 10 groups", () => {
		const ast = tokenize("(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\\10");
		// 10 groups (indices 0-9), then \\10 → backreference to group 10
		const ref = ast.branches[0][10];
		assert.equal(ref.kind, "backreference");
		if (ref.kind === "backreference") assert.equal(ref.index, 10);
	});

	it("downgrades \\10 to char(8) with 9 groups", () => {
		const ast = tokenize("(a)(b)(c)(d)(e)(f)(g)(h)(i)\\10");
		// 9 groups, \\10 > 9 → backreference-to-octal: digits "10" → octal "10" = 8
		const ref = ast.branches[0][9];
		assert.equal(ref.kind, "char");
		if (ref.kind === "char") assert.equal(ref.value, 8);
	});

	it("parses \\10 as backreference with group defined after digit", () => {
		const ast = tokenize("(a)(b)(c)(d)(e)(f)(g)(h)(i) - \\10 (j)");
		// 9 groups before \\10, but (j) makes 10 total → backreference
		const tokens = ast.branches[0];
		// 9 groups + ' ' + '-' + ' ' + backref + ' ' + group
		const ref = tokens[12];
		assert.equal(ref.kind, "backreference");
		if (ref.kind === "backreference") assert.equal(ref.index, 10);
	});

	it("parses \\10 with 1 group as char(8)", () => {
		const ast = tokenize(String.raw`<(\w+)>\w*<\10>`);
		const tokens = ast.branches[0];
		// '<' group '>' rep '<' char(8) '>'  → indices 0-6
		assert.equal(tokens[5].kind, "char");
		if (tokens[5].kind === "char") assert.equal(tokens[5].value, 8);
	});

	it("parses nested capturing groups \\1", () => {
		const ast = tokenize("(a) ((b) (c)) - \\1");
		const tokens = ast.branches[0];
		const ref = tokens[tokens.length - 1];
		assert.equal(ref.kind, "backreference");
		if (ref.kind === "backreference") assert.equal(ref.index, 1);
	});

	it("parses nested capturing groups \\2", () => {
		const ast = tokenize("(a) ((b) (c)) - \\2");
		const tokens = ast.branches[0];
		const ref = tokens[tokens.length - 1];
		assert.equal(ref.kind, "backreference");
		if (ref.kind === "backreference") assert.equal(ref.index, 2);
	});

	it("parses nested capturing groups \\3", () => {
		const ast = tokenize("(a) ((b) (c)) - \\3");
		const tokens = ast.branches[0];
		const ref = tokens[tokens.length - 1];
		assert.equal(ref.kind, "backreference");
		if (ref.kind === "backreference") assert.equal(ref.index, 3);
	});

	it("parses nested capturing groups \\4", () => {
		const ast = tokenize("(a) ((b) (c)) - \\4");
		const tokens = ast.branches[0];
		const ref = tokens[tokens.length - 1];
		assert.equal(ref.kind, "backreference");
		if (ref.kind === "backreference") assert.equal(ref.index, 4);
	});

	it("downgrades \\5 to char when only 4 groups exist", () => {
		const ast = tokenize("(a) ((b) (c)) - \\5");
		const tokens = ast.branches[0];
		const ref = tokens[tokens.length - 1];
		assert.equal(ref.kind, "char");
		if (ref.kind === "char") assert.equal(ref.value, 5);
	});

	it("parses \\k<name>", () => {
		const ast = tokenize(String.raw`(?<year>\d{4})-\k<year>`);
		const ref = ast.branches[0][2];
		assert.equal(ref.kind, "backreference");
		if (ref.kind === "backreference") {
			assert.equal(ref.index, 1);
		}
	});

	it("parses \\k<name> forward reference", () => {
		const ast = tokenize(String.raw`(\k<foo>)-(?<foo>bar)`);
		const g = ast.branches[0][0];
		assert.equal(g.kind, "group");
		if (g.kind === "group") {
			const ref = g.branches[0][0];
			assert.equal(ref.kind, "backreference");
			if (ref.kind === "backreference") assert.equal(ref.index, 2);
		}
	});
});

// ── Unicode code point escapes ──────────────────────────────────────

describe("Parser; unicode escapes", () => {
	it("parses \\u{1F600}", () => {
		const ast = tokenize("\\u{1F600}");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") {
			assert.equal(tok.value, 0x1f600);
		}
	});

	it("parses \\u{0}", () => {
		const ast = tokenize("\\u{0}");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") {
			assert.equal(tok.value, 0);
		}
	});

	it("parses \\u00E9", () => {
		const ast = tokenize("\\u00E9");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") {
			assert.equal(tok.value, 0x00e9);
		}
	});

	it("parses \\x2F", () => {
		const ast = tokenize("\\x2F");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") {
			assert.equal(tok.value, 0x2f);
		}
	});
});

// ── Octal escapes ───────────────────────────────────────────────────

describe("Parser; octal escapes", () => {
	it("parses \\0 as null char", () => {
		const ast = tokenize("\\0");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 0);
	});

	it("parses \\00 as octal 0", () => {
		const ast = tokenize("\\00");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 0);
	});

	it("parses \\01 as octal 1", () => {
		const ast = tokenize("\\01");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 1);
	});

	it("parses \\010 as octal 8", () => {
		const ast = tokenize("\\010");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 8);
	});

	it("parses \\377 as octal 255", () => {
		const ast = tokenize("\\377");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 255);
	});

	it("parses \\08 as null + literal 8", () => {
		const ast = tokenize("\\08");
		assert.equal(ast.branches[0].length, 2);
		const first = ast.branches[0][0];
		assert.equal(first.kind, "char");
		if (first.kind === "char") assert.equal(first.value, 0);
		const second = ast.branches[0][1];
		assert.equal(second.kind, "char");
		if (second.kind === "char") assert.equal(second.value, 56);
	});

	// Escaped octal numbers
	it("parses \\10 without groups as char(8)", () => {
		const ast = tokenize("\\10");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 8);
	});

	it('parses \\18 without groups as char(1) + char("8")', () => {
		const ast = tokenize("\\18");
		assert.equal(ast.branches[0].length, 2);
		assert.equal(ast.branches[0][0].kind, "char");
		if (ast.branches[0][0].kind === "char")
			assert.equal(ast.branches[0][0].value, 1);
		assert.equal(ast.branches[0][1].kind, "char");
		if (ast.branches[0][1].kind === "char")
			assert.equal(ast.branches[0][1].value, 56);
	});

	it('parses \\108 without groups as char(8) + char("8")', () => {
		const ast = tokenize("\\108");
		assert.equal(ast.branches[0].length, 2);
		assert.equal(ast.branches[0][0].kind, "char");
		if (ast.branches[0][0].kind === "char")
			assert.equal(ast.branches[0][0].value, 8);
		assert.equal(ast.branches[0][1].kind, "char");
		if (ast.branches[0][1].kind === "char")
			assert.equal(ast.branches[0][1].value, 56);
	});

	it("parses \\107 without groups as char(71)", () => {
		// \\107 → octal 107 = 71
		const ast = tokenize("\\107");
		assert.equal(ast.branches[0].length, 1);
		assert.equal(ast.branches[0][0].kind, "char");
		if (ast.branches[0][0].kind === "char")
			assert.equal(ast.branches[0][0].value, 71);
	});

	it('parses \\9 without groups as char("9")', () => {
		// \\9 is not a valid backreference or octal → literal '9'
		const ast = tokenize("\\9");
		assert.equal(ast.branches[0].length, 1);
		assert.equal(ast.branches[0][0].kind, "char");
		if (ast.branches[0][0].kind === "char")
			assert.equal(ast.branches[0][0].value, 57);
	});

	it('parses \\90 without groups as char("9") + char("0")', () => {
		const ast = tokenize("\\90");
		assert.equal(ast.branches[0].length, 2);
		assert.equal(ast.branches[0][0].kind, "char");
		if (ast.branches[0][0].kind === "char")
			assert.equal(ast.branches[0][0].value, 57);
		assert.equal(ast.branches[0][1].kind, "char");
		if (ast.branches[0][1].kind === "char")
			assert.equal(ast.branches[0][1].value, 48);
	});
});

// ── Escaped metacharacters ──────────────────────────────────────────

describe("Parser; escaped metacharacters", () => {
	it("parses escaped special chars as literals", () => {
		const cases = [
			"\\.",
			"\\|",
			"\\?",
			"\\(",
			"\\)",
			"\\{",
			"\\}",
			"\\\\",
			"\\[",
			"\\$",
			"\\^",
		];
		for (const c of cases) {
			const ast = tokenize(c);
			const tok = ast.branches[0][0];
			assert.equal(tok.kind, "char", `Expected ${c} to parse as char`);
		}
	});
});

// ── Control escapes ─────────────────────────────────────────────────

describe("Parser; control escapes \\cX", () => {
	it("parses \\cA (uppercase) as control char 1", () => {
		const ast = tokenize("\\cA");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 1);
	});

	it("parses \\ca (lowercase) as control char 1", () => {
		const ast = tokenize("\\ca");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 1);
	});

	it("parses \\c_ (underscore) as control char 31 (unit separator)", () => {
		const ast = tokenize("\\c_");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 31);
	});

	it("parses \\c? as control char 31", () => {
		const ast = tokenize("\\c?");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 31);
	});

	it("parses \\c@ as control char 0 (nul)", () => {
		const ast = tokenize("\\c@");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 0);
	});
});

// ── Error cases ─────────────────────────────────────────────────────

describe("Parser; errors", () => {
	it("throws on \\ at end of pattern", () => {
		assert.throws(() => tokenize("foo\\"), /\\ at end of pattern/);
	});

	it("throws on pattern too large", () => {
		const big = "a".repeat(100_001);
		assert.throws(() => tokenize(big), /too large/);
	});

	it("throws on invalid group after ?", () => {
		assert.throws(() => tokenize("(?_abc)"), /Invalid group/);
	});

	it("throws on invalid named group first character", () => {
		assert.throws(() => tokenize("(?<1a>.)"), /Invalid capture group name/);
	});

	it("throws on unclosed capture group name", () => {
		assert.throws(
			() => tokenize("(?<name!abc)"),
			/Unclosed capture group name/,
		);
	});

	it("throws on invalid \\k<name> reference to nonexistent group", () => {
		assert.throws(() => tokenize("\\k<nonexistent>"), /Invalid group name/);
	});

	it("throws on invalid unicode escape \\u{110000} above 0x10FFFF", () => {
		assert.throws(() => tokenize("\\u{110000}"), /Invalid Unicode escape/);
	});

	it("throws on sequential lazy quantifier", () => {
		assert.throws(() => tokenize("a???"), /Nothing to repeat/);
	});

	it("parses \\k without < as literal k", () => {
		const ast = tokenize("\\k");
		const tok = ast.branches[0][0];
		assert.equal(tok.kind, "char");
		if (tok.kind === "char") assert.equal(tok.value, 107);
	});

	it("parses empty group ()", () => {
		const ast = tokenize("()");
		const g = ast.branches[0][0];
		assert.equal(g.kind, "group");
		if (g.kind === "group") {
			assert.equal(g.branches[0].length, 0);
		}
	});

	it("parses backreference-to-octal converting \\18 (1 group)", () => {
		// \\18 with 1 group: \\1 is a backreference but we have groupCount=1 < 18
		// → digits "18" contains non-octal '8' → split into octal 1 + char 8
		const ast = tokenize("(a)\\18");
		assert.equal(ast.branches[0].length, 3);
		assert.equal(ast.branches[0][2].kind, "char");
		if (ast.branches[0][2].kind === "char") {
			assert.equal(ast.branches[0][2].value, 56); // '8'
		}
	});

	it("parses empty alternatives inside group (a|)", () => {
		const ast = tokenize("(a|)");
		const g = ast.branches[0][0];
		assert.equal(g.kind, "group");
		if (g.kind === "group") {
			assert.equal(g.branches.length, 2);
			assert.equal(g.branches[0].length, 1);
			assert.equal(g.branches[1].length, 0);
		}
	});

	it("parses empty alternatives inside group (a|b|)", () => {
		const ast = tokenize("(a|b|)");
		const g = ast.branches[0][0];
		assert.equal(g.kind, "group");
		if (g.kind === "group") {
			assert.equal(g.branches.length, 3);
			assert.equal(g.branches[0].length, 1);
			assert.equal(g.branches[1].length, 1);
			assert.equal(g.branches[2].length, 0);
		}
	});

	it("parses named group with underscore in name", () => {
		const ast = tokenize("(?<_myGroup_>.)");
		const g = ast.branches[0][0];
		assert.equal(g.kind, "group");
		if (g.kind === "group") {
			assert.equal(g.capturing, true);
			assert.equal(g.name, "_myGroup_");
		}
	});

	it("parses named group with digit in name", () => {
		const ast = tokenize("(?<group2>.)");
		const g = ast.branches[0][0];
		assert.equal(g.kind, "group");
		if (g.kind === "group") {
			assert.equal(g.capturing, true);
			assert.equal(g.name, "group2");
		}
	});

	it("parses very large backreference index with many groups", () => {
		const groups = Array.from(
			{ length: 50 },
			(_, i) => `(${String.fromCharCode(97 + (i % 26))})`,
		).join("");
		const ast = tokenize(`${groups}\\50`);
		const ref = ast.branches[0][50];
		assert.equal(ref.kind, "backreference");
		if (ref.kind === "backreference") {
			assert.equal(ref.index, 50);
		}
	});

	it("downgrades large backreference to octal when fewer groups", () => {
		// \\50 with only 5 groups → octal 50 = 40
		const ast = tokenize("(a)(b)(c)(d)(e)\\50");
		const ref = ast.branches[0][5];
		assert.equal(ref.kind, "char");
		if (ref.kind === "char") {
			assert.equal(ref.value, 40);
		}
	});

	it("parses pattern with only ^ anchor", () => {
		const ast = tokenize("^");
		assert.equal(ast.branches[0].length, 1);
		assert.deepEqual(ast.branches[0][0], { kind: "position", value: "^" });
	});

	it("parses pattern with only $ anchor", () => {
		const ast = tokenize("$");
		assert.equal(ast.branches[0].length, 1);
		assert.deepEqual(ast.branches[0][0], { kind: "position", value: "$" });
	});

	it("parses empty \\q{} inside character class", () => {
		const ast = tokenize(String.raw`[\q{}]`);
		const set = ast.branches[0][0];
		assert.equal(set.kind, "charset");
		if (set.kind === "charset") {
			assert.equal(set.members.length, 1);
			const m = set.members[0];
			assert.equal(m.kind, "string_member");
			if (m.kind === "string_member") {
				assert.equal(m.strings.length, 0);
			}
		}
	});

	it("parses zero-quantifier a{0}", () => {
		const ast = tokenize("a{0}");
		const rep = ast.branches[0][0];
		assert.equal(rep.kind, "repetition");
		if (rep.kind === "repetition") {
			assert.equal(rep.min, 0);
			assert.equal(rep.max, 0);
		}
	});

	it("parses zero-zero quantifier a{0,0}", () => {
		const ast = tokenize("a{0,0}");
		const rep = ast.branches[0][0];
		assert.equal(rep.kind, "repetition");
		if (rep.kind === "repetition") {
			assert.equal(rep.min, 0);
			assert.equal(rep.max, 0);
		}
	});

	it("parses zero-to-one quantifier a{0,1} as optional", () => {
		const ast = tokenize("a{0,1}");
		const rep = ast.branches[0][0];
		assert.equal(rep.kind, "repetition");
		if (rep.kind === "repetition") {
			assert.equal(rep.min, 0);
			assert.equal(rep.max, 1);
			assert.equal(rep.greedy, true);
		}
	});

	it("parses one-to-one quantifier a{1,1}", () => {
		const ast = tokenize("a{1,1}");
		const rep = ast.branches[0][0];
		assert.equal(rep.kind, "repetition");
		if (rep.kind === "repetition") {
			assert.equal(rep.min, 1);
			assert.equal(rep.max, 1);
		}
	});

	it("parses lookbehind with alternation (?<=a|b)c", () => {
		const ast = tokenize("(?<=a|b)c");
		const g = ast.branches[0][0];
		assert.equal(g.kind, "group");
		if (g.kind === "group") {
			assert.equal(g.lookbehind, true);
			assert.equal(g.branches.length, 2);
		}
	});

	it("parses lookbehind with quantifier (?<=a+)c", () => {
		const ast = tokenize("(?<=a+)c");
		const g = ast.branches[0][0];
		assert.equal(g.kind, "group");
		if (g.kind === "group") {
			assert.equal(g.lookbehind, true);
			assert.equal(g.branches.length, 1);
			const rep = g.branches[0][0];
			assert.equal(rep.kind, "repetition");
			if (rep.kind === "repetition") {
				assert.equal(rep.min, 1);
				assert.equal(rep.max, Infinity);
			}
		}
	});

	it("parses negative lookbehind with quantifier (?<!a+)c", () => {
		const ast = tokenize("(?<!a+)c");
		const g = ast.branches[0][0];
		assert.equal(g.kind, "group");
		if (g.kind === "group") {
			assert.equal(g.negatedLookbehind, true);
			assert.equal(g.branches.length, 1);
		}
	});

	it("parses lookbehind (?<=abc) and verifies round-trip", () => {
		const ast = tokenize("(?<=abc)");
		const reconstructed = generate(ast);
		assert.equal(reconstructed, "(?<=abc)");
	});

	it("parses negative lookbehind (?<!abc) and verifies round-trip", () => {
		const ast = tokenize("(?<!abc)");
		const reconstructed = generate(ast);
		assert.equal(reconstructed, "(?<!abc)");
	});

	it("parses deeply nested groups (5 levels)", () => {
		const ast = tokenize("(a(b(c(d(e)f)g)h)i)");
		const g0 = ast.branches[0][0];
		assert.equal(g0.kind, "group");
		if (g0.kind === "group") {
			assert.equal(g0.branches[0].length, 3); // a, group, i
			const g1 = g0.branches[0][1];
			assert.equal(g1.kind, "group");
			if (g1.kind === "group") {
				assert.equal(g1.branches[0].length, 3);
			}
		}
	});
});

// ── Escape termination ─────────────────────────────────────────────

describe("Parser; escape termination", () => {
	it("treats \\q without { as identity escape (non-v semantics)", () => {
		// Plain-mode JavaScript parses [\qz] as the class [qz]; v-mode would
		// reject it, but the parser is flag-agnostic and keeps the non-v
		// fallback, consistent with \p -> p and \k -> k.
		const ast = tokenize(String.raw`[\qz]`);
		const set = ast.branches[0][0] as CharSetNode;
		assert.deepEqual(set.members, [
			{ kind: "char", value: 113 }, // q
			{ kind: "char", value: 122 }, // z
		]);
	});

	it("throws on unterminated \\q{ inside class", () => {
		assert.throws(() => tokenize(String.raw`[\q{abc`), /Unterminated/);
	});

	it("throws on unterminated \\p{ at top level", () => {
		assert.throws(() => tokenize("\\p{L"), /Unterminated \\p\{\.\.\.\} escape/);
	});

	it("throws on unterminated \\p{ inside class", () => {
		assert.throws(() => tokenize("[\\p{L"), /Unterminated/);
	});

	it("throws on unterminated \\k< even when the named group exists", () => {
		// V8 rejects (?<foo>a)\k<foo as an invalid capture group name; the
		// missing > must never quietly parse as a valid backreference.
		assert.throws(
			() => tokenize("(?<foo>a)\\k<foo"),
			/Unterminated \\k<\.\.\.> reference/,
		);
	});
});
