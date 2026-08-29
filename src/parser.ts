import type {
	BackreferenceNode,
	CharSetNode,
	GroupNode,
	RootNode,
	SetMember,
	Token,
} from "./ast.js";
import { digits, dot, whitespace, wordChars } from "./preset.js";

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_PATTERN_LENGTH = 100_000;
const HYPHEN = 45; // '-' code point
const CAPTURE_NAME_FIRST = /^[a-zA-Z_$]$/;
const CAPTURE_NAME_CHAR = /^[a-zA-Z0-9_$]$/;
const OCTAL_DIGIT = /^[0-7]$/;
const DIGIT = /^\d$/;

// ── Errors ────────────────────────────────────────────────────────────────

class ParseError extends SyntaxError {
	constructor(pattern: string, message: string, position?: number) {
		const truncated =
			pattern.length > 60 ? `${pattern.slice(0, 60)}...` : pattern;
		const pos = position !== undefined ? ` at column ${position}` : "";
		super(`Invalid regular expression: /${truncated}/: ${message}${pos}`);
		this.name = "ParseError";
	}
}

// ── Escape resolution ─────────────────────────────────────────────────────

function resolveEscapes(source: string): string {
	// Matches any character after \c -- V8 accepts any code unit;
	// the control code is codepoint % 32.
	const escRe =
		/(\[\\b\])|(\\)?\\(?:u\{([A-Fa-f0-9]{1,6})\}|u([A-Fa-f0-9]{4})|x([A-Fa-f0-9]{2})|c([\s\S])|(0(?!\d)|[tnvfr]))/g;
	const ctrlTable: Record<string, number> = {
	// Group 1 matches `[\b]`, a class containing only \b (backspace inside
	// a character class), which normalizes to the bare backspace character.
		"@": 0,
		A: 1,
		B: 2,
		C: 3,
		D: 4,
		E: 5,
		F: 6,
		G: 7,
		H: 8,
		I: 9,
		J: 10,
		K: 11,
		L: 12,
		M: 13,
		N: 14,
		O: 15,
		P: 16,
		Q: 17,
		R: 18,
		S: 19,
		T: 20,
		U: 21,
		V: 22,
		W: 23,
		X: 24,
		Y: 25,
		Z: 26,
		"[": 27,
		"\\": 28,
		"]": 29,
		"^": 30,
		"?": 31,
	};
	const simpleEscapes: Record<string, number> = {
		"0": 0,
		t: 9,
		n: 10,
		v: 11,
		f: 12,
		r: 13,
	};

	return source.replace(
		escRe,
		(match, classBackspace, literalBackslash, ubrace, u4, x2, ctrl, simple) => {
			if (literalBackslash) return match;
			if (classBackspace) return "\u0008";

			let code: number;
			if (ubrace) {
				code = parseInt(ubrace, 16);
				if (code > 0x10ffff)
					throw new ParseError(source, "Invalid Unicode escape");
			} else if (u4) {
				code = parseInt(u4, 16);
			} else if (x2) {
				code = parseInt(x2, 16);
			} else if (ctrl) {
				code = ctrlTable[ctrl] ?? ctrl.codePointAt(0)! % 32;
			} else {
				code = simpleEscapes[simple] ?? 0;
			}

			try {
				const c = String.fromCodePoint(code);
				return /[[\]{}^$.|?*+()\\]/.test(c) ? `\\${c}` : c;
			} catch {
				return String.fromCharCode(code);
			}
		},
	);
}

// ── Tokenizer ─────────────────────────────────────────────────────────────

export function tokenize(pattern: string): RootNode {
	if (pattern.length > MAX_PATTERN_LENGTH) {
		throw new ParseError(pattern, "Regular expression too large");
	}

	const resolved = resolveEscapes(pattern);
	const chars = [...resolved];
	let pos = 0;

	const root: RootNode = { kind: "root", branches: [[]] };
	const groupStack: GroupNode[] = [];

	// Returns the branch that new tokens should be appended to.
	function currentBranch(): Token[] {
		const g = groupStack.length > 0 ? groupStack[groupStack.length - 1]! : root;
		return g.branches[g.branches.length - 1]!;
	}

	const backrefs: {
		node: BackreferenceNode;
		branch: Token[];
		index: number;
	}[] = [];
	const namedBackrefs: {
		node: BackreferenceNode;
		name: string;
		branch: Token[];
		index: number;
	}[] = [];
	const nameToIndex = new Map<string, number>();
	let groupCount = 0;

	function peek(offset = 0): string | undefined {
		return chars[pos + offset];
	}

	function advance(): string {
		return chars[pos++]!;
	}

	function atEnd(): boolean {
		return pos >= chars.length;
	}

	// ── Character class parsing ───────────────────────────────────────

	/**
	 * Post-processes a flat member list to detect -- (subtract) and &&
	 * (intersect) operators and builds the set op tree.
	 * && binds tighter than --; both are left-associative.
	 */
	function buildSetOpTree(members: SetMember[]): SetMember[] {
		// Phase 1: detect operator sentinels pushed by the lexer.
		// Operators have shape { _op: "subtract" | "intersect" }.
		type OpSentinel = { _op: "subtract" | "intersect" };
		const items: (SetMember | OpSentinel)[] = [];
		for (const m of members) {
			if ((m as any)._op) {
				items.push(m as any as OpSentinel);
			} else {
				items.push(m);
			}
		}

		// Phase 2: build tree. && binds tighter → group && first.
		return buildOps(items, "intersect");
	}

	function isOp(
		item: SetMember | { _op: "subtract" | "intersect" },
		op: "subtract" | "intersect",
	): item is { _op: "subtract" | "intersect" } {
		return (item as any)._op === op;
	}

	/** Left-associative grouping of `items` by `op`. */
	function buildOps(
		items: (SetMember | { _op: "subtract" | "intersect" })[],
		op: "subtract" | "intersect",
	): SetMember[] {
		// First pass: combine with the given operator
		const result: (SetMember | { _op: "subtract" | "intersect" })[] = [];
		let i = 0;
		while (i < items.length) {
			const item = items[i]!;
			if (isOp(item, op)) {
				const left = result.pop()!;
				i++;
				if (i >= items.length) {
					result.push(left as SetMember);
					break;
				}
				const right = items[i]!;
				if (isOp(right, "subtract") || isOp(right, "intersect")) {
					result.push(left as SetMember);
					result.push(right);
				} else {
					result.push({
						kind: "set_op",
						operator: op,
						left: left as SetMember,
						right: right as SetMember,
					});
				}
				i++;
			} else {
				result.push(item);
				i++;
			}
		}

		// If we just handled intersects, now handle subtracts (lower precedence)
		if (op === "intersect") {
			return buildOps(result, "subtract");
		}

		return result as SetMember[];
	}

	function parseCharClass(): CharSetNode {
		let negated = false;
		if (!atEnd() && peek() === "^") {
			negated = true;
			advance();
		}

		const members: SetMember[] = [];
		let rangeStart: number | null = null;
		let awaitingRangeEnd = false;
		let foundClosing = false;
		let hasSetOps = false;
		let prevWasEscapedDash = false;

		function flushPending(): void {
			if (rangeStart !== null) {
				members.push({ kind: "char", value: rangeStart });
				rangeStart = null;
			}
			awaitingRangeEnd = false;
		}

		while (!atEnd()) {
			const c = advance();
			if (c === "]") {
				foundClosing = true;
				const hadPendingRange = awaitingRangeEnd;
				flushPending();
				if (hadPendingRange) {
					// Trailing dash before ]: literal hyphen
					members.push({ kind: "char", value: HYPHEN });
				}
				break;
			}

			if (c === "\\") {
				if (atEnd())
					throw new ParseError(pattern, "Unterminated character class");
				const esc = advance();

				// Helper: add a literal escape result (the actual code point)
				const addEscapedChar = (code: number) => {
					// Code points > 0xFFFF must be split into surrogate pairs inside classes
					if (code > 0xffff) {
						const hi = Math.floor((code - 0x10000) / 0x400) + 0xd800;
						const lo = ((code - 0x10000) % 0x400) + 0xdc00;
						addEscapedChar(hi);
						addEscapedChar(lo);
						return;
					}
					if (awaitingRangeEnd && rangeStart !== null) {
						if (rangeStart > code)
							throw new ParseError(
								pattern,
								"Range out of order in character class",
							);
						members.push({ kind: "range", from: rangeStart, to: code });
						rangeStart = null;
						awaitingRangeEnd = false;
					} else {
						flushPending();
						rangeStart = code;
					}
					if (code === HYPHEN) prevWasEscapedDash = true;
				};

				switch (esc) {
					case "d":
						flushPending();
						members.push(digits());
						break;
					case "D":
						flushPending();
						members.push({ ...digits(), negated: true });
						break;
					case "w":
						flushPending();
						members.push(wordChars());
						break;
					case "W":
						flushPending();
						members.push({ ...wordChars(), negated: true });
						break;
					case "s":
						flushPending();
						members.push(whitespace());
						break;
					case "S":
						flushPending();
						members.push({ ...whitespace(), negated: true });
						break;
					case "p":
					case "P": {
						flushPending();
						if (!atEnd() && peek() === "{") {
							advance();
							let propName = "";
							while (!atEnd() && peek() !== "}") propName += advance();
							if (!atEnd()) advance();
							members.push({
								kind: "unicode_property",
								property: propName,
								negated: esc === "P",
							});
						} else {
							addEscapedChar(esc.codePointAt(0)!);
						}
						break;
					}
					case "q": {
						flushPending();
						if (!atEnd() && peek() === "{") {
							advance();
							const strings: number[][] = [[]];
							while (!atEnd() && peek() !== "}") {
								const ch = advance();
								if (ch === "|") {
									strings.push([]);
								} else {
									strings[strings.length - 1]!.push(ch.codePointAt(0)!);
								}
							}
							// Drop trailing empty string if | was the last char
							if (
								strings.length > 0 &&
								strings[strings.length - 1]!.length === 0
							) {
								strings.pop();
							}
							if (!atEnd()) advance();
							members.push({ kind: "string_member", strings, negated: false });
						}
						break;
					}
					case "b":
						addEscapedChar(8);
						break;
					default:
						addEscapedChar(esc.codePointAt(0)!);
				}
				continue;
			}

			if ((c === "-" || c === "&") && !atEnd() && peek() === c) {
				if (c === "-" && prevWasEscapedDash) {
					prevWasEscapedDash = false;
					if (rangeStart !== null) {
						awaitingRangeEnd = true;
					} else {
						members.push({ kind: "char", value: HYPHEN });
					}
					continue;
				}
				flushPending();
				advance();
				(members as any).push({ _op: c === "-" ? "subtract" : "intersect" });
				hasSetOps = true;
				prevWasEscapedDash = false;
				continue;
			}

			prevWasEscapedDash = false;

			// Nested character class: only in v-mode set-op context
			if (c === "[" && hasSetOps) {
				flushPending();
				members.push(parseCharClass());
				continue;
			}

			if (c === "-") {
				if (rangeStart !== null) {
					awaitingRangeEnd = true;
				} else {
					members.push({ kind: "char", value: HYPHEN });
				}
				continue;
			}

			// Regular character
			const code = c.codePointAt(0)!;
			if (code > 0xffff) {
				// Split into surrogate pair
				const hi = Math.floor((code - 0x10000) / 0x400) + 0xd800;
				const lo = ((code - 0x10000) % 0x400) + 0xdc00;
				for (const cp of [hi, lo]) {
					if (awaitingRangeEnd && rangeStart !== null) {
						if (rangeStart > cp)
							throw new ParseError(
								pattern,
								"Range out of order in character class",
							);
						members.push({ kind: "range", from: rangeStart, to: cp });
						rangeStart = null;
						awaitingRangeEnd = false;
					} else {
						flushPending();
						rangeStart = cp;
					}
				}
			} else if (awaitingRangeEnd && rangeStart !== null) {
				if (rangeStart > code) {
					throw new ParseError(
						pattern,
						"Range out of order in character class",
					);
				}
				members.push({ kind: "range", from: rangeStart, to: code });
				rangeStart = null;
				awaitingRangeEnd = false;
			} else {
				flushPending();
				rangeStart = code;
			}
		}

		if (!foundClosing) {
			throw new ParseError(pattern, "Unterminated character class");
		}

		flushPending();

		// ── Set operation post-processing ───────────────────────────────
		// Detect -- (subtract) and && (intersect) from adjacent char members
		// and build the set op tree. && binds tighter than --.

		const processed = buildSetOpTree(members);
		return { kind: "charset", negated, members: processed };
	}

	// ── Quantifier parsing ────────────────────────────────────────────

	function parseQuantifier(): { min: number; max: number } | null {
		const startPos = pos;
		let minStr = "";
		while (!atEnd() && DIGIT.test(peek()!)) minStr += advance();
		if (minStr.length === 0) {
			pos = startPos;
			return null;
		}

		let maxStr = "";
		let hasComma = false;
		if (!atEnd() && peek() === ",") {
			hasComma = true;
			advance();
			while (!atEnd() && DIGIT.test(peek()!)) maxStr += advance();
		}

		if (atEnd() || peek() !== "}") {
			pos = startPos;
			return null;
		}
		advance();

		const min = parseInt(minStr, 10);
		let max: number;
		if (maxStr.length > 0) max = parseInt(maxStr, 10);
		else if (hasComma) max = Infinity;
		else max = min;

		if (max !== Infinity && min > max) {
			throw new ParseError(pattern, "Numbers out of order in {} quantifier");
		}
		return { min, max };
	}
	/** Consumes a trailing `?` that marks the preceding quantifier as lazy. */
	function consumeLazyFlag(): boolean {
		if (!atEnd() && peek() === "?") {
			advance();
			return false;
		}
		return true;
	}


	function applyQuantifier(min: number, max: number, column: number): void {
		const branch = currentBranch();
		if (branch.length === 0) {
			throw new ParseError(pattern, "Nothing to repeat", column);
		}
		const child = branch.pop()!;
		const greedy = consumeLazyFlag();
		branch.push({ kind: "repetition", min, max, greedy, child });
	}

	// ── Main loop ─────────────────────────────────────────────────────

	while (!atEnd()) {
		const c = advance();
		const col = pos;
		const branch = currentBranch();

		switch (c) {
			case "\\": {
				if (atEnd()) throw new ParseError(pattern, "\\ at end of pattern");
				const esc = advance();

				switch (esc) {
					case "b":
						branch.push({ kind: "position", value: "b" });
						break;
					case "B":
						branch.push({ kind: "position", value: "B" });
						break;
					case "d":
						branch.push(digits());
						break;
					case "D":
						branch.push({ ...digits(), negated: true });
						break;
					case "w":
						branch.push(wordChars());
						break;
					case "W":
						branch.push({ ...wordChars(), negated: true });
						break;
					case "s":
						branch.push(whitespace());
						break;
					case "S":
						branch.push({ ...whitespace(), negated: true });
						break;
					case "p":
					case "P": {
						if (!atEnd() && peek() === "{") {
							advance();
							let propName = "";
							while (!atEnd() && peek() !== "}") propName += advance();
							if (!atEnd()) advance();
							branch.push({
								kind: "unicode_property",
								property: propName,
								negated: esc === "P",
							});
						} else {
							branch.push({ kind: "char", value: esc.codePointAt(0)! });
						}
						break;
					}
					case "k": {
						if (!atEnd() && peek() === "<") {
							advance();
							let name = "";
							while (!atEnd() && peek() !== ">") name += advance();
							if (!atEnd()) advance();
							const ref: BackreferenceNode = {
								kind: "backreference",
								index: 0,
							};
							branch.push(ref);
							namedBackrefs.push({
								node: ref,
								name,
								branch,
								index: branch.length - 1,
							});
						} else {
							branch.push({ kind: "char", value: 107 });
						}
						break;
					}
					default: {
						if (DIGIT.test(esc)) {
							if (esc === "0") {
								let octal = esc;
								let count = 0;
								while (!atEnd() && OCTAL_DIGIT.test(peek()!) && count < 2) {
									octal += advance();
									count++;
								}
								branch.push({ kind: "char", value: parseInt(octal, 8) });
							} else {
								let digitsStr = esc;
								while (!atEnd() && DIGIT.test(peek()!)) digitsStr += advance();
								const value = parseInt(digitsStr, 10);
								const ref: BackreferenceNode = {
									kind: "backreference",
									index: value,
								};
								branch.push(ref);
								backrefs.push({ node: ref, branch, index: branch.length - 1 });
							}
						} else {
							branch.push({ kind: "char", value: esc.codePointAt(0)! });
						}
					}
				}
				break;
			}

			case "^":
				branch.push({ kind: "position", value: "^" });
				break;
			case "$":
				branch.push({ kind: "position", value: "$" });
				break;
			case ".":
				branch.push(dot());
				break;
			case "[":
				branch.push(parseCharClass());
				break;

			case "(": {
				const group: GroupNode = {
					kind: "group",
					capturing: true,
					branches: [[]],
				};

				if (!atEnd() && peek() === "?") {
					advance();
					if (atEnd()) throw new ParseError(pattern, "Invalid group", pos);
					const mod = advance();
					group.capturing = false;

					if (mod === ":") {
						// non-capturing
					} else if (mod === "=") {
						group.lookahead = true;
					} else if (mod === "!") {
						group.negatedLookahead = true;
					} else if (mod === "<") {
						if (atEnd()) throw new ParseError(pattern, "Invalid group", pos);
						const next = peek()!;
						if (next === "=") {
							advance();
							group.lookbehind = true;
						} else if (next === "!") {
							advance();
							group.negatedLookbehind = true;
						} else {
							group.capturing = true;
							let name = "";
							if (!CAPTURE_NAME_FIRST.test(next)) {
								throw new ParseError(
									pattern,
									`Invalid capture group name, character '${next}' after '<'`,
									pos,
								);
							}
							name += advance();
							while (!atEnd() && CAPTURE_NAME_CHAR.test(peek()!))
								name += advance();
							if (atEnd() || peek() !== ">") {
								throw new ParseError(
									pattern,
									"Unclosed capture group name, expected >",
									pos,
								);
							}
							advance();
							if (nameToIndex.has(name))
								throw new ParseError(pattern, "Duplicate capture group name");
							group.name = name;
						}
					} else if (/[ims-]/.test(mod)) {
						let flagStr = mod;
						while (!atEnd() && /[ims-]/.test(peek()!)) flagStr += advance();
						group.modifiers = flagStr;
						if (!atEnd() && peek() === ":") advance();
					} else {
						throw new ParseError(
							pattern,
							`Invalid group, character '${mod}' after '?'`,
							pos,
						);
					}
				}

				if (group.capturing) {
					groupCount++;
					if (group.name) nameToIndex.set(group.name, groupCount);
				}

				branch.push(group);
				groupStack.push(group);
				break;
			}

			case ")": {
				if (groupStack.length === 0) {
					throw new ParseError(pattern, "Unmatched )", col);
				}
				groupStack.pop();
				break;
			}

			case "|": {
				const g =
					groupStack.length > 0 ? groupStack[groupStack.length - 1]! : root;
				g.branches.push([]);
				break;
			}

			case "{": {
				const q = parseQuantifier();
				if (q) applyQuantifier(q.min, q.max, col);
				else branch.push({ kind: "char", value: 123 });
				break;
			}

			case "?": {
				const prev = branch[branch.length - 1];
				if (prev && prev.kind === "repetition" && prev.greedy) {
					prev.greedy = false;
				} else if (prev && prev.kind === "repetition" && !prev.greedy) {
					throw new ParseError(pattern, "Nothing to repeat", col);
				} else if (branch.length === 0) {
					throw new ParseError(pattern, "Nothing to repeat", col);
				} else {
					const child = branch.pop()!;
					const greedy = consumeLazyFlag();
					branch.push({ kind: "repetition", min: 0, max: 1, greedy, child });
				}
				break;
			}

			case "*": {
				if (branch.length === 0)
					throw new ParseError(pattern, "Nothing to repeat", col);
				const prev = branch[branch.length - 1]!;
				if (prev.kind === "repetition")
					throw new ParseError(pattern, "Nothing to repeat", col);
				const child = branch.pop()!;
				const greedy = consumeLazyFlag();
				branch.push({
					kind: "repetition",
					min: 0,
					max: Infinity,
					greedy,
					child,
				});
				break;
			}

			case "+": {
				if (branch.length === 0)
					throw new ParseError(pattern, "Nothing to repeat", col);
				const prev = branch[branch.length - 1]!;
				if (prev.kind === "repetition")
					throw new ParseError(pattern, "Nothing to repeat", col);
				const child = branch.pop()!;
				const greedy = consumeLazyFlag();
				branch.push({
					kind: "repetition",
					min: 1,
					max: Infinity,
					greedy,
					child,
				});
				break;
			}

			default:
				branch.push({ kind: "char", value: c.codePointAt(0)! });
		}
	}

	if (groupStack.length > 0) {
		throw new ParseError(pattern, "Unterminated group");
	}

	// Resolve numeric backreferences
	for (const { node, branch, index } of backrefs.reverse()) {
		if (groupCount < node.index) {
			const indexDigits = String(node.index);
			if (!/^[0-7]+$/.test(indexDigits)) {
				let i = 0;
				while (i < indexDigits.length && OCTAL_DIGIT.test(indexDigits[i]!)) i++;
				const headLen = i;
				const replacement: Token[] = [];
				if (headLen > 0) {
					replacement.push({
						kind: "char",
						value: parseInt(indexDigits.slice(0, headLen), 8),
					});
				}
				for (let j = headLen; j < indexDigits.length; j++) {
					replacement.push({
						kind: "char",
						value: indexDigits.charCodeAt(j),
					});
				}
				branch.splice(index, 1, ...replacement);
			} else {
				branch[index] = {
					kind: "char",
					value: parseInt(indexDigits, 8),
				};
			}
		}
	}

	// Resolve named backreferences
	for (const { name, branch, index } of namedBackrefs) {
		const groupIdx = nameToIndex.get(name);
		if (groupIdx !== undefined) {
			branch[index] = { kind: "backreference", index: groupIdx };
		} else {
			throw new ParseError(pattern, "Invalid group name in \\k<...>");
		}
	}

	return root;
}
