import type { CharSetNode, Node, SetMember, Token } from "./ast.js";
import {
	DIGITS_LOOKUP,
	LINE_TERMINATORS_LOOKUP,
	type SetLookup,
	WHITESPACE_LOOKUP,
	WORD_CHARS_LOOKUP,
} from "./preset.js";

// ── Character escaping ────────────────────────────────────────────────────

/**
 * Returns the string representation of a code point for use inside a
 * character class, escaping ^, \, ], and - as needed.
 */
function setChar(cp: number): string {
	if (cp === 94) return "\\^";
	if (cp === 92) return "\\\\";
	if (cp === 93) return "\\]";
	if (cp === 45) return "\\-";
	return String.fromCodePoint(cp);
}

// Characters that must be escaped outside a character class.
// [ must be escaped because bare [ starts a new char class.
// { } must be escaped because bare { starts a quantifier.
// ] is safe: bare ] outside a class is always literal.
const METACHAR_REGEX = /[[\\{}$^.|?*+()]/;

/**
 * Returns the string representation of a code point for use outside a
 * character class, escaping special regex metacharacters.
 */
function literalChar(cp: number): string {
	const ch = String.fromCodePoint(cp);
	if (METACHAR_REGEX.test(ch)) return `\\${ch}`;
	return ch;
}

// ── Set comparison ────────────────────────────────────────────────────────

/**
 * Checks if a character set matches a predefined lookup for shorthand
 * optimization (e.g., output \d instead of [0-9]).
 */
function matchesLookup(members: SetMember[], lookup: SetLookup): boolean {
	if (members.length !== lookup.size) return false;
	for (const m of members) {
		if (m.kind !== "char" && m.kind !== "range") return false; // nested set or unicode property
		const key = m.kind === "char" ? String(m.value) : `${m.from}-${m.to}`;
		if (!lookup.entries.has(key)) return false;
	}
	return true;
}

// ── Set member rendering ──────────────────────────────────────────────────

function renderSetMember(m: SetMember, _nested: boolean): string {
	switch (m.kind) {
		case "char":
			return setChar(m.value);
		case "range":
			return `${setChar(m.from)}-${setChar(m.to)}`;
		case "unicode_property":
			return `\\${m.negated ? "P" : "p"}{${m.property}}`;
		case "charset":
			return renderCharSet(m, _nested);
		case "string_member": {
			if (m.strings.length === 0) return "";
			const parts = m.strings.map((s) =>
				s.map((cp) => String.fromCodePoint(cp)).join(""),
			);
			return `\\q{${parts.join("|")}}`;
		}
		case "set_op": {
			const renderOp = (op: SetMember): string => {
				// Only bare chars can appear without brackets in v-mode.
				// Ranges, charsets, and nested set ops need wrapping.
				const needsBrackets = op.kind !== "char" && op.kind !== "string_member";
				if (!needsBrackets) return renderSetMember(op, true);
				const inner = renderSetMember(op, true);
				return `[${inner}]`;
			};
			return `${renderOp(m.left)}${m.operator === "subtract" ? "--" : "&&"}${renderOp(m.right)}`;
		}
		default:
			throw new Error(
				`Unknown set member kind: ${(m as { kind: string }).kind}`,
			);
	}
}

/**
 * Reconstructs a character class node into its regex string representation.
 */
function renderCharSet(set: CharSetNode, nested = false): string {
	const { members, negated } = set;

	// Shorthand detection: if a set exactly matches a predefined set,
	// output the shorthand escape instead of the expanded form.
	if (!nested && matchesLookup(members, DIGITS_LOOKUP)) {
		return negated ? "\\D" : "\\d";
	}
	if (!nested && matchesLookup(members, WORD_CHARS_LOOKUP)) {
		return negated ? "\\W" : "\\w";
	}
	if (!nested && matchesLookup(members, WHITESPACE_LOOKUP)) {
		return negated ? "\\S" : "\\s";
	}
	if (!nested && negated && matchesLookup(members, LINE_TERMINATORS_LOOKUP)) {
		return ".";
	}

	const content = members
		.map((m: SetMember) => renderSetMember(m, true))
		.join("");
	const body = `${negated ? "^" : ""}${content}`;
	return nested ? body : `[${body}]`;
}

// ── Token rendering ───────────────────────────────────────────────────────

function renderBranch(tokens: Token[]): string {
	return tokens.map(renderToken).join("");
}

function renderBranches(branches: Token[][]): string {
	return branches.map((b: Token[]) => renderBranch(b)).join("|");
}

function renderToken(token: Token): string {
	switch (token.kind) {
		case "char":
			return literalChar(token.value);

		case "position":
			if (token.value === "^" || token.value === "$") {
				return token.value;
			}
			return `\\${token.value}`;

		case "backreference":
			return `\\${token.index}`;

		case "unicode_property":
			return `\\${token.negated ? "P" : "p"}{${token.property}}`;

		case "charset":
			return renderCharSet(token);

		case "repetition": {
			const { min, max, greedy, child } = token;
			let suffix: string;
			if (min === 0 && max === 1) suffix = "?";
			else if (min === 1 && max === Infinity) suffix = "+";
			else if (min === 0 && max === Infinity) suffix = "*";
			else if (max === Infinity) suffix = `{${min},}`;
			else if (min === max) suffix = `{${min}}`;
			else suffix = `{${min},${max}}`;
			return `${renderToken(child)}${suffix}${greedy ? "" : "?"}`;
		}

		case "group": {
			let prefix: string;
			if (token.modifiers) {
				const hasContent = token.branches.some((b) => b.length > 0);
				prefix = `?${token.modifiers}${hasContent ? ":" : ""}`;
			} else if (token.lookbehind) {
				prefix = "?<=";
			} else if (token.negatedLookbehind) {
				prefix = "?<!";
			} else if (token.lookahead) {
				prefix = "?=";
			} else if (token.negatedLookahead) {
				prefix = "?!";
			} else if (token.name) {
				prefix = `?<${token.name}>`;
			} else if (!token.capturing) {
				prefix = "?:";
			} else {
				prefix = "";
			}
			return `(${prefix}${renderBranches(token.branches)})`;
		}

		default:
			throw new Error(`Unknown token kind: ${(token as Token).kind}`);
	}
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Reconstructs a regex pattern string from an AST node.
 * This is the inverse of `tokenize()`.
 */
export function generate(node: Node): string {
	if (node.kind === "root") {
		return renderBranches(node.branches);
	}
	return renderToken(node);
}
