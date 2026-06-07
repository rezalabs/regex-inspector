import type { CharMember, CharSetNode, RangeMember } from "./ast.js";

// ── Predefined Character Sets ──────────────────────────────────────────────

/**
 * Digit set: [0-9]
 * Used for \d and \D (negated).
 */
export function digits(): CharSetNode {
	return {
		kind: "charset",
		negated: false,
		members: [{ kind: "range", from: 48, to: 57 }],
	};
}

/**
 * Word character set: [_a-zA-Z0-9]
 * Used for \w and \W (negated).
 */
export function wordChars(): CharSetNode {
	return {
		kind: "charset",
		negated: false,
		members: [
			{ kind: "char", value: 95 }, // _
			{ kind: "range", from: 97, to: 122 }, // a-z
			{ kind: "range", from: 65, to: 90 }, // A-Z
			{ kind: "range", from: 48, to: 57 }, // 0-9
		],
	};
}

/**
 * Whitespace set: all characters matched by \s in JavaScript.
 */
export function whitespace(): CharSetNode {
	return {
		kind: "charset",
		negated: false,
		members: [
			{ kind: "char", value: 9 }, // \t
			{ kind: "char", value: 10 }, // \n
			{ kind: "char", value: 11 }, // \v
			{ kind: "char", value: 12 }, // \f
			{ kind: "char", value: 13 }, // \r
			{ kind: "char", value: 32 }, // space
			{ kind: "char", value: 160 }, // non-breaking space
			{ kind: "char", value: 5760 }, // ogham space mark
			{ kind: "range", from: 8192, to: 8202 },
			{ kind: "char", value: 8232 }, // line separator
			{ kind: "char", value: 8233 }, // paragraph separator
			{ kind: "char", value: 8239 }, // narrow no-break space
			{ kind: "char", value: 8287 }, // medium mathematical space
			{ kind: "char", value: 12288 }, // ideographic space
			{ kind: "char", value: 65279 }, // zero width no-break space (BOM)
		],
	};
}

/**
 * Line terminator set: characters excluded by `.` (dot).
 * . matches any single character except line terminators.
 */
export function lineTerminators(): CharSetNode {
	return {
		kind: "charset",
		negated: false,
		members: [
			{ kind: "char", value: 10 }, // \n
			{ kind: "char", value: 13 }, // \r
			{ kind: "char", value: 8232 }, // line separator
			{ kind: "char", value: 8233 }, // paragraph separator
		],
	};
}

/**
 * Negated set helpers. Wrap a CharSetNode with negated: true.
 */
export function negate(set: CharSetNode): CharSetNode {
	return { ...set, negated: !set.negated };
}

/**
 * Dot `.`: any character except line terminators.
 * Represented as a negated character set of line terminators.
 */
export function dot(): CharSetNode {
	return { ...lineTerminators(), negated: true };
}

// ── Set comparison support ─────────────────────────────────────────────────
// Used by the generator to detect when a char set matches a predefined
// shorthand (e.g., output \d instead of [0-9]).

/** A lookup map for fast set comparison. */
export type SetLookup = {
	size: number;
	entries: Map<string, boolean>;
};

function toLookup(members: (CharMember | RangeMember)[]): SetLookup {
	const entries = new Map<string, boolean>();
	for (const m of members) {
		const key = m.kind === "char" ? String(m.value) : `${m.from}-${m.to}`;
		entries.set(key, true);
	}
	return { size: members.length, entries };
}

export const DIGITS_LOOKUP = toLookup(
	digits().members as (CharMember | RangeMember)[],
);
export const WORD_CHARS_LOOKUP = toLookup(
	wordChars().members as (CharMember | RangeMember)[],
);
export const WHITESPACE_LOOKUP = toLookup(
	whitespace().members as (CharMember | RangeMember)[],
);
export const LINE_TERMINATORS_LOOKUP = toLookup(
	lineTerminators().members as (CharMember | RangeMember)[],
);
