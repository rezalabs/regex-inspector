// ── AST Node Types ─────────────────────────────────────────────────────────
// All nodes use a `kind` string discriminant instead of numeric enums for
// better debuggability, JSON serialization, and IDE autocompletion.

/** A single literal character, stored as its Unicode code point. */
export type CharNode = {
	kind: "char";
	/** Unicode code point. */
	value: number;
};

/** A position anchor: ^, $, \b, \B. */
export type PositionNode = {
	kind: "position";
	value: "^" | "$" | "b" | "B";
};

/** A Unicode property escape: \p{...} or \P{...}. */
export type UnicodePropertyNode = {
	kind: "unicode_property";
	/** The property name (e.g. "L", "Script=Latin"). */
	property: string;
	/** True for \P{...}, false for \p{...}. */
	negated: boolean;
};

/** A backreference to a capturing group by index. */
export type BackreferenceNode = {
	kind: "backreference";
	/** 1-based capturing group index. */
	index: number;
};

/** A character range inside a character class: `a-z`. */
export type RangeMember = {
	kind: "range";
	/** Inclusive start code point. */
	from: number;
	/** Inclusive end code point. */
	to: number;
};

/** A single character inside a character class. */
export type CharMember = {
	kind: "char";
	/** Unicode code point. */
	value: number;
};

/** A v-mode string literal inside a character class: `\q{abc|def}`. */
export type StringMemberNode = {
	kind: "string_member";
	/** Alternatives separated by `|` inside `\q{...}`. Each inner array is a string of code points. */
	strings: number[][];
	/** True for `\P{...}` style negation? No. `\q` has no negated form. Kept for uniform SetMember handling. */
	negated: boolean;
};

/** A v-mode set operation: `[a-z--[ab]]` (subtract) or `[a-z&&[ab]]` (intersect). */
export type SetOpNode = {
	kind: "set_op";
	/** "subtract" for `--`, "intersect" for `&&`. */
	operator: "subtract" | "intersect";
	left: SetMember;
	right: SetMember;
};

/** A member of a character class set. */
export type SetMember =
	| CharMember
	| RangeMember
	| CharSetNode
	| UnicodePropertyNode
	| StringMemberNode
	| SetOpNode;

/** A character class: `[...]` or `[^...]`. */
export type CharSetNode = {
	kind: "charset";
	/** True for `[^...]`, false for `[...]`. */
	negated: boolean;
	/** The tokens inside the class. */
	members: SetMember[];
};

/** A quantifier (repetition) wrapping a child token. */
export type RepetitionNode = {
	kind: "repetition";
	/** Minimum repetitions. */
	min: number;
	/** Maximum repetitions; `Infinity` for unbounded. */
	max: number;
	/** True for greedy, false for lazy. */
	greedy: boolean;
	/** The token being repeated. */
	child: Token;
};

/** A group: `(...)`, `(?:...)`, `(?=...)`, `(?<name>...)`, etc. */
export type GroupNode = {
	kind: "group";
	/** True for capturing groups `(...)` and `(?<name>...)`. */
	capturing: boolean;
	/** Alternatives separated by `|`. A linear group has one branch. */
	branches: Token[][];
	/** Positive lookahead `(?=...)`. */
	lookahead?: boolean;
	/** Negative lookahead `(?!...)`. */
	negatedLookahead?: boolean;
	/** Positive lookbehind `(?<=...)`. */
	lookbehind?: boolean;
	/** Negative lookbehind `(?<!...)`. */
	negatedLookbehind?: boolean;
	/** Named capture group name (from `(?<name>...)`). */
	name?: string;
	/** Modifier flags string (from `(?ims-ims:...)` or `(?i)`). */
	modifiers?: string;
};

/** The root node of a regex pattern. */
export type RootNode = {
	kind: "root";
	/** Alternatives separated by top-level `|`. A linear pattern has one branch. */
	branches: Token[][];
};

/** Any AST node that can appear inside a branch (root or group). */
export type Token =
	| CharNode
	| PositionNode
	| UnicodePropertyNode
	| BackreferenceNode
	| CharSetNode
	| RepetitionNode
	| GroupNode;

/** All AST node types. */
export type Node = RootNode | Token;
