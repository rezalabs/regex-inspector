import type {
	CharSetNode,
	Node,
	RangeMember,
	SetMember,
	Token,
} from "./ast.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type Severity = "none" | "low" | "high" | "critical";

export type AnalysisResult = {
	safe: boolean;
	severity: Severity;
	reasons: string[];
	starHeight: number;
	repCount: number;
	hasAlternationReDoS: boolean;
	hasSequentialOverlap: boolean;
	anchored: boolean;
	hasStaticSuffix: boolean;
	fix: string | null;
};

export type AnalyzeOptions = {
	limit?: number;
};

/**
 * Default value for AnalyzeOptions.limit: the maximum number of
 * repetitions a pattern may contain before it is flagged.
 */
export const DEFAULT_REPETITION_LIMIT = 25;

// ── Token leaf extraction ─────────────────────────────────────────────────

function getFirstLeaf(node: Token): Token | null {
	if (
		node.kind === "char" ||
		node.kind === "charset" ||
		node.kind === "unicode_property"
	)
		return node;
	if (node.kind === "repetition") return getFirstLeaf(node.child);
	if (node.kind === "group") {
		const firstBranch = node.branches[0];
		if (firstBranch && firstBranch.length > 0) {
			return getFirstLeaf(firstBranch[0]!);
		}
		return null;
	}
	return null;
}

function getAllFirstLeaves(node: Token): Token[] {
	if (
		node.kind === "char" ||
		node.kind === "charset" ||
		node.kind === "unicode_property"
	)
		return [node];
	if (node.kind === "repetition") return getAllFirstLeaves(node.child);
	if (node.kind === "group") {
		const leaves: Token[] = [];
		for (const branch of node.branches) {
			if (branch.length > 0) {
				leaves.push(...getAllFirstLeaves(branch[0]!));
			}
		}
		return leaves;
	}
	return [];
}

function isNonOptional(node: Token): boolean {
	if (
		node.kind === "char" ||
		node.kind === "charset" ||
		node.kind === "unicode_property"
	)
		return true;
	if (node.kind === "position" || node.kind === "backreference") return false;
	if (node.kind === "repetition") return node.min >= 1;
	if (node.kind === "group") {
		for (const branch of node.branches) {
			if (branch.length === 0 || !isNonOptional(branch[0]!)) return false;
		}
		return node.branches.length > 0;
	}
	return false;
}

// ── Character set overlap ─────────────────────────────────────────────────

function codeInMembers(cp: number, members: SetMember[]): boolean {
	for (const m of members) {
		if (m.kind === "char" && m.value === cp) return true;
		if (m.kind === "range" && cp >= m.from && cp <= m.to) return true;
		if (m.kind === "charset") {
			if (codeMatchesSet(cp, m)) return true;
		}
		if (m.kind === "string_member") {
			for (const s of m.strings) {
				if (s.length === 1 && s[0] === cp) return true;
			}
		}
		if (m.kind === "set_op") {
			const inLeft = codeInMembers(cp, [m.left]);
			const inRight = codeInMembers(cp, [m.right]);
			if (m.operator === "subtract" && inLeft && !inRight) return true;
			if (m.operator === "intersect" && inLeft && inRight) return true;
		}
		// Conservative: can't determine character membership of unicode
		// property escapes. Assume the code point is in the set.
		if (m.kind === "unicode_property") return true;
	}
	return false;
}

function codeMatchesSet(cp: number, set: CharSetNode): boolean {
	const inEntries = codeInMembers(cp, set.members);
	return set.negated ? !inEntries : inEntries;
}

function membersOverlap(a: SetMember, b: SetMember): boolean {
	// Conservative: new node types always assume overlap.
	if (
		a.kind === "string_member" ||
		a.kind === "set_op" ||
		a.kind === "unicode_property" ||
		a.kind === "charset"
	)
		return true;
	if (
		b.kind === "string_member" ||
		b.kind === "set_op" ||
		b.kind === "unicode_property" ||
		b.kind === "charset"
	)
		return true;

	if (a.kind !== "char" && a.kind !== "range") return false;
	if (b.kind !== "char" && b.kind !== "range") return false;

	if (a.kind === "range" && b.kind === "range") {
		return a.from <= b.to && b.from <= a.to;
	}
	if (a.kind === "char" && b.kind === "char") {
		return a.value === b.value;
	}
	// CHAR vs RANGE
	const charNode = (a.kind === "char" ? a : b) as {
		kind: "char";
		value: number;
	};
	const charVal = charNode.value;
	const range = (a.kind === "range" ? a : b) as RangeMember;
	return charVal >= range.from && charVal <= range.to;
}

function setsOverlap(a: CharSetNode, b: CharSetNode): boolean {
	if (a.negated && b.negated) return true;

	if (a.negated !== b.negated) {
		const pos = a.negated ? b : a;
		const neg = a.negated ? a : b;
		for (const m of pos.members) {
			if (m.kind === "char") {
				if (!codeInMembers(m.value, neg.members)) return true;
			} else if (m.kind === "range") {
				if (!codeInMembers(m.from, neg.members)) return true;
				if (m.from !== m.to && !codeInMembers(m.to, neg.members)) return true;
			} else if (
				m.kind === "string_member" ||
				m.kind === "set_op" ||
				m.kind === "unicode_property"
			) {
				// Conservative: new node types may expand beyond the negated set
				return true;
			} else if (m.kind === "charset") {
				// Nested charset inside positive set.
				// If negated, conservatively assume overlap.
				if (m.negated) return true;
				for (const sm of m.members) {
					if (sm.kind === "char") {
						if (!codeInMembers(sm.value, neg.members)) return true;
					} else if (sm.kind === "range") {
						if (!codeInMembers(sm.from, neg.members)) return true;
						if (sm.from !== sm.to && !codeInMembers(sm.to, neg.members))
							return true;
					} else {
						// Deeper nesting: conservatively assume overlap
						return true;
					}
				}
			}
		}
		return false;
	}

	for (const ma of a.members) {
		for (const mb of b.members) {
			if (membersOverlap(ma, mb)) return true;
		}
	}
	return false;
}

function tokensOverlap(a: Token, b: Token): boolean {
	// Conservative: can't determine character membership of unicode property
	// escapes without full Unicode data. Assume overlap.
	if (a.kind === "unicode_property" || b.kind === "unicode_property")
		return true;
	if (a.kind === "char" && b.kind === "char") return a.value === b.value;
	if (a.kind === "char" && b.kind === "charset")
		return codeMatchesSet(a.value, b);
	if (a.kind === "charset" && b.kind === "char")
		return codeMatchesSet(b.value, a);
	if (a.kind === "charset" && b.kind === "charset") return setsOverlap(a, b);
	return false;
}

// ── Unambiguous nested repetition ─────────────────────────────────────────

function isUnambiguous(node: Token): boolean {
	let branches: Token[][];
	if (node.kind === "group") {
		branches = node.branches;
	} else {
		branches = [[node]];
	}

	for (const branch of branches) {
		if (branch.length === 0) return false;

		const first = branch[0]!;
		if (!isNonOptional(first)) return false;

		// Single-branch single-token: can't be unambiguous (classic nested rep).
		// Multi-branch single-token: within-branch check is N/A; rely on
		// cross-branch overlap check below.
		if (branch.length < 2) {
			if (branches.length === 1) return false;
			continue;
		}

		const firstLeaves = getAllFirstLeaves(first);
		const secondLeaf = getFirstLeaf(branch[1]!);
		if (firstLeaves.length === 0 || !secondLeaf) return false;

		for (const leaf of firstLeaves) {
			if (tokensOverlap(leaf, secondLeaf)) return false;
		}
	}

	if (branches.length > 1) {
		const allFirsts = branches.map((b) => getAllFirstLeaves(b[0]!));
		for (let i = 0; i < allFirsts.length; i++) {
			for (let j = i + 1; j < allFirsts.length; j++) {
				for (const ai of allFirsts[i]!) {
					for (const bj of allFirsts[j]!) {
						if (tokensOverlap(ai, bj)) return false;
					}
				}
			}
		}
	}

	return true;
}

// ── Alternation overlap detection ─────────────────────────────────────────

function getPrefixTokens(branch: Token[]): Token[] {
	const tokens: Token[] = [];
	for (const t of branch) {
		if (
			t.kind === "char" ||
			t.kind === "charset" ||
			t.kind === "unicode_property"
		) {
			tokens.push(t);
			continue;
		}
		// Repetition with min >= 1 has a mandatory first character;
		// extract the first leaf of its child as the effective prefix token.
		if (t.kind === "repetition" && t.min >= 1) {
			const leaf = getFirstLeaf(t.child);
			if (leaf) {
				tokens.push(leaf);
				continue;
			}
		}
		break;
	}
	return tokens;
}

function hasAlternationReDoS(branches: Token[][]): boolean {
	if (branches.length < 2) return false;

	const prefixes = branches
		.map((b) => getPrefixTokens(b))
		.filter((p) => p.length > 0);

	if (prefixes.length < 2) return false;

	for (let i = 0; i < prefixes.length; i++) {
		for (let j = i + 1; j < prefixes.length; j++) {
			const a = prefixes[i]!;
			const b = prefixes[j]!;
			const shorter = a.length <= b.length ? a : b;
			const longer = a.length <= b.length ? b : a;

			let prefixMatch = true;
			for (let k = 0; k < shorter.length; k++) {
				if (!tokensOverlap(shorter[k]!, longer[k]!)) {
					prefixMatch = false;
					break;
				}
			}
			if (prefixMatch) return true;
		}
	}
	return false;
}

function findAlternationReDoS(node: Token | Node): boolean {
	if (!node || typeof node !== "object" || !("kind" in node)) return false;
	const n = node as Node;
	if (n.kind === "group" && hasAlternationReDoS(n.branches)) return true;
	if (n.kind === "root" || n.kind === "group") {
		const branches = n.branches;
		for (const branch of branches) {
			for (const child of branch) {
				if (findAlternationReDoS(child)) return true;
			}
		}
	}
	if (n.kind === "repetition") {
		if (findAlternationReDoS(n.child)) return true;
	}
	return false;
}

// ── Last-leaf extraction ─────────────────────────────────────────────────

/**
 * Returns the set of tokens that can appear at the end of a match for `node`.
 * Mirrors `getAllFirstLeaves` but for the trailing edge.
 */
function getAllLastLeaves(node: Token): Token[] {
	if (
		node.kind === "char" ||
		node.kind === "charset" ||
		node.kind === "unicode_property"
	)
		return [node];
	if (node.kind === "repetition") return getAllLastLeaves(node.child);
	if (node.kind === "group") {
		const leaves: Token[] = [];
		for (const branch of node.branches) {
			if (branch.length > 0) {
				leaves.push(...getAllLastLeaves(branch[branch.length - 1]!));
			}
		}
		return leaves;
	}
	return [];
}

// ── Sequential overlap detection ──────────────────────────────────────────

/** Returns true when `node` is or contains a repetition (quantifier). */
function containsRepetition(node: Token): boolean {
	if (node.kind === "repetition") return true;
	if (node.kind === "group") {
		for (const branch of node.branches) {
			for (const child of branch) {
				if (containsRepetition(child)) return true;
			}
		}
	}
	return false;
}

/**
 * Checks whether the trailing match domain of token `a` overlaps with the
 * leading match domain of token `b`. Only flagged when `a` is or contains a
 * quantifier; a literal followed by a quantifier does not create the same
 * over-consume risk because the literal cannot expand.
 */
function hasDangerAdjacency(a: Token, b: Token): boolean {
	if (!containsRepetition(a)) return false;
	const lastLeaves = getAllLastLeaves(a);
	const firstLeaves = getAllFirstLeaves(b);
	if (lastLeaves.length === 0 || firstLeaves.length === 0) return false;
	for (const la of lastLeaves) {
		for (const fb of firstLeaves) {
			if (tokensOverlap(la, fb)) return true;
		}
	}
	return false;
}

/**
 * Walks the AST looking for branches that contain two or more consecutive
 * quantifier→next-token pairs where the quantifier's charset overlaps the
 * next token's first character. A single such adjacency inside a repeated
 * group is also considered dangerous because the outer repetition amplifies
 * the overlap into exponential backtracking.
 *
 * Examples:
 *   .*?B.*?C        → 2 adjacencies → flagged
 *   (.*?,){11}P     → 1 adjacency inside repeated group → flagged
 *   a+b+            → 0 adjacencies (a does not overlap b) → safe
 */
function findSequentialOverlap(
	node: Token | Node,
	insideRepetition: boolean,
): boolean {
	if (node.kind === "repetition") {
		return findSequentialOverlap(node.child, true);
	}

	if (node.kind === "root" || node.kind === "group") {
		for (const branch of node.branches) {
			let dangerCount = 0;
			for (let i = 0; i < branch.length - 1; i++) {
				if (hasDangerAdjacency(branch[i]!, branch[i + 1]!)) {
					dangerCount++;
					// dangerCount is always >= 1 here (just incremented above)
					if (insideRepetition) return true;
					if (dangerCount >= 2) return true;
				}
			}
			for (const child of branch) {
				if (
					child.kind === "repetition" &&
					findSequentialOverlap(child.child, true)
				)
					return true;
				if (child.kind === "group" && findSequentialOverlap(child, false))
					return true;
			}
		}
	}

	return false;
}

// ── Anchoring and suffix detection ────────────────────────────────────────

function detectAnchored(root: Node): boolean {
	if (root.kind !== "root") return false;
	const branches = root.branches;
	if (branches.length !== 1) return false;
	const stack = branches[0]!;
	if (stack.length < 2) return false;
	const first = stack[0]!;
	const last = stack[stack.length - 1]!;
	return (
		first.kind === "position" &&
		first.value === "^" &&
		last.kind === "position" &&
		last.value === "$"
	);
}

/** Returns the trailing char/charset token of a single-branch root, or null. */
function getSuffixToken(root: Node): Token | null {
	if (root.kind !== "root") return null;
	const branches = root.branches;
	if (branches.length !== 1) return null;
	const stack = branches[0]!;
	for (let i = stack.length - 1; i >= 0; i--) {
		const child = stack[i]!;
		if (child.kind === "position") continue;
		if (child.kind === "char" || child.kind === "charset") return child;
		break;
	}
	return null;
}

/**
 * Checks whether any repetition in the AST has a child whose character set
 * overlaps with `suffix`. If so, the suffix does NOT mitigate backtracking
 * because preceding quantifiers can consume the suffix character, forcing
 * the engine to backtrack through them before reaching it.
 */
function suffixIsExclusive(node: Token | Node, suffix: Token): boolean {
	if (node.kind === "repetition") {
		// Use getAllLastLeaves to extract actual character-matching tokens
		// from the repetition's child (which may be a group, another
		// repetition, or a leaf token). tokensOverlap alone fails on groups.
		const lastLeaves = getAllLastLeaves(node.child);
		for (const leaf of lastLeaves) {
			if (tokensOverlap(leaf, suffix)) return false;
		}
		return suffixIsExclusive(node.child, suffix);
	}
	if (node.kind === "root" || node.kind === "group") {
		for (const branch of node.branches) {
			for (const child of branch) {
				if (!suffixIsExclusive(child, suffix)) return false;
			}
		}
	}
	return true;
}

function detectStaticSuffix(root: Node): boolean {
	const suffix = getSuffixToken(root);
	if (!suffix) return false;
	return suffixIsExclusive(root, suffix);
}

// ── AST walking ───────────────────────────────────────────────────────────

interface WalkState {
	starHeight: number;
	maxStarHeight: number;
	repCount: number;
	limit: number;
}

function walkBranches(branches: Token[][], fn: (child: Token) => void): void {
	for (const branch of branches) {
		for (const child of branch) {
			fn(child);
		}
	}
}

function walkAnalyze(node: Token | Node, state: WalkState): void {
	if (node.kind === "repetition") {
		state.starHeight++;
		if (state.starHeight > state.maxStarHeight) {
			state.maxStarHeight = state.starHeight;
		}
		state.repCount++;
		walkAnalyze(node.child, state);
		state.starHeight--;
		return;
	}

	if (node.kind === "root" || node.kind === "group") {
		walkBranches(node.branches, (child) => walkAnalyze(child, state));
	}
}

function walkSafe(node: Token | Node, state: WalkState): boolean {
	if (node.kind === "repetition") {
		state.starHeight++;
		state.repCount++;

		// isUnambiguous is pure; compute once instead of up to three times.
		const unambiguous = isUnambiguous(node.child);
		if (state.starHeight > 1 && !unambiguous) return false;
		if (state.repCount > state.limit) return false;

		if (findAlternationReDoS(node.child)) return false;

		const savedHeight = state.starHeight;
		if (unambiguous) {
			state.starHeight = 0;
		}
		const result = walkSafe(node.child, state);
		if (unambiguous) {
			state.starHeight = savedHeight;
		}
		state.starHeight--;
		return result;
	}

	if (node.kind === "root" || node.kind === "group") {
		for (const branch of node.branches) {
			for (const child of branch) {
				if (!walkSafe(child, state)) return false;
			}
		}
	}
	// Leaf tokens are inherently safe
	return true;
}

// ── Severity assessment ───────────────────────────────────────────────────

function assessSeverity(
	starHeight: number,
	repCount: number,
	limit: number,
	hasAlternation: boolean,
	hasSeqOverlap: boolean,
	anchored: boolean,
	hasStaticSuffix: boolean,
): Severity {
	if (starHeight >= 3) return "critical";
	if (starHeight >= 2 || hasAlternation || hasSeqOverlap) {
		const mitigated = (anchored ? 1 : 0) + (hasStaticSuffix ? 1 : 0);
		return mitigated >= 1 ? "low" : "high";
	}
	if (repCount > limit * 2) return "high";
	if (repCount > limit) return "low";
	return "none";
}

// ── Public API ────────────────────────────────────────────────────────────

export function analyze(ast: Node, opts: AnalyzeOptions = {}): AnalysisResult {
	const limit = opts.limit ?? DEFAULT_REPETITION_LIMIT;

	const state: WalkState = {
		starHeight: 0,
		maxStarHeight: 0,
		repCount: 0,
		limit,
	};
	walkAnalyze(ast, state);

	const hasAlt = findAlternationReDoS(ast);
	const hasSeqOverlap = findSequentialOverlap(ast, false);
	const anchored = detectAnchored(ast);
	const hasSuffix = detectStaticSuffix(ast);

	const severity = assessSeverity(
		state.maxStarHeight,
		state.repCount,
		limit,
		hasAlt,
		hasSeqOverlap,
		anchored,
		hasSuffix,
	);

	const safeState: WalkState = {
		starHeight: 0,
		maxStarHeight: 0,
		repCount: 0,
		limit,
	};
	const walkSafeResult = walkSafe(ast, safeState);
	const safe = walkSafeResult && !hasSeqOverlap;

	const reasons: string[] = [];
	const finalSeverity: Severity = safe ? "none" : severity;

	if (!safe) {
		if (state.maxStarHeight >= 2) {
			reasons.push(
				`Nested repetition detected (star height ${state.maxStarHeight})`,
			);
		}
		if (hasAlt) {
			reasons.push("Alternatives with overlapping prefixes inside quantifier");
		}
		if (hasSeqOverlap) {
			reasons.push(
				"Sequential overlapping quantifiers: adjacent repetitions whose match domains overlap allowing cascading backtracking",
			);
		}
		if (state.repCount > limit) {
			reasons.push(`Exceeded repetition limit: ${state.repCount} > ${limit}`);
		}
	}

	return {
		safe,
		severity: finalSeverity,
		reasons,
		starHeight: state.maxStarHeight,
		repCount: state.repCount,
		hasAlternationReDoS: hasAlt,
		hasSequentialOverlap: hasSeqOverlap,
		anchored,
		hasStaticSuffix: hasSuffix,
		fix: null,
	};
}
