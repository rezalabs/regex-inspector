import { analyze, DEFAULT_REPETITION_LIMIT } from "./analyze.js";
import type { GroupNode, Node, RepetitionNode, Token } from "./ast.js";
import { generate } from "./generator.js";
import { tokenize } from "./parser.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type FixResult = {
	safe: boolean;
	fixed: string | null;
	original: string;
	semanticChange: boolean;
};

export type FixOptions = {
	limit?: number;
};

// ── AST utilities ─────────────────────────────────────────────────────────

function cloneNode<T extends Node | Token>(node: T): T {
	return JSON.parse(JSON.stringify(node), (key, value) => {
		if (value === null && key === "max") return Infinity;
		return value;
	}) as T;
}

function hasDeepRepetition(
	node: Token,
	depth: number,
	maxDepth: number,
): boolean {
	if (node.kind === "repetition") {
		depth++;
		if (depth > maxDepth) return true;
		return hasDeepRepetition(node.child, depth, maxDepth);
	}
	if (node.kind === "group") {
		for (const branch of node.branches) {
			for (const child of branch) {
				if (hasDeepRepetition(child, depth, maxDepth)) return true;
			}
		}
	}
	return false;
}

// ── Fix strategies ────────────────────────────────────────────────────────

/**
 * Collapses same-character alternatives inside a quantifier.
 * (a|aa|aaa)+ → a+
 */
function fixAlternationReDoS(repNode: RepetitionNode): Token | null {
	const group = findGroupWithAlternatives(repNode.child);
	if (!group) return null;

	let allSameChar = true;
	let firstChar: number | null = null;

	for (const branch of group.branches) {
		for (const token of branch) {
			if (token.kind === "char") {
				if (firstChar === null) firstChar = token.value;
				if (token.value !== firstChar) allSameChar = false;
			} else {
				allSameChar = false;
				break;
			}
		}
		if (!allSameChar) break;
	}

	if (allSameChar && firstChar !== null) {
		return {
			kind: "repetition",
			min: repNode.min,
			max: repNode.max,
			greedy: repNode.greedy,
			child: { kind: "char", value: firstChar },
		};
	}

	return null;
}

function findGroupWithAlternatives(node: Token): GroupNode | null {
	if (node.kind === "group" && node.branches.length >= 2) return node;
	if (node.kind === "group") {
		for (const branch of node.branches) {
			for (const child of branch) {
				const found = findGroupWithAlternatives(child);
				if (found) return found;
			}
		}
	}
	if (node.kind === "repetition") return findGroupWithAlternatives(node.child);
	return null;
}

// ── Recursive fixer ───────────────────────────────────────────────────────

function fixNode(node: Token): Token {
	if (node.kind === "repetition") {
		// Strip outer quantifier if nested repetition detected
		if (hasDeepRepetition(node.child, 1, 1)) {
			return fixNode(node.child);
		}
		// Collapse same-character alternatives
		const altFix = fixAlternationReDoS(node);
		if (altFix) return altFix;

		const result = cloneNode(node);
		result.child = fixNode(result.child);
		return result;
	}

	if (node.kind === "group") {
		const result = cloneNode(node);
		result.branches = result.branches.map((branch) =>
			branch.map((child) => fixNode(child)),
		);
		return result;
	}

	return node;
}

// ── Public API ────────────────────────────────────────────────────────────

export function fixRegex(
	pattern: string | Node,
	opts: FixOptions = {},
): FixResult {
	const limit = opts.limit ?? DEFAULT_REPETITION_LIMIT;
	const source = typeof pattern === "string" ? pattern : generate(pattern);

	let ast: Node;
	try {
		ast = typeof pattern === "string" ? tokenize(pattern) : pattern;
	} catch {
		return {
			safe: false,
			fixed: null,
			original: source,
			semanticChange: false,
		};
	}

	const analysis = analyze(ast, { limit });
	if (analysis.safe) {
		return {
			safe: true,
			fixed: null,
			original: source,
			semanticChange: false,
		};
	}

	const fixedAst = cloneNode(ast);
	if (fixedAst.kind === "root") {
		fixedAst.branches = fixedAst.branches.map((branch) =>
			branch.map((child) => fixNode(child)),
		);
	}

	let fixed: string;
	try {
		fixed = generate(fixedAst);
	} catch {
		return {
			safe: false,
			fixed: null,
			original: source,
			semanticChange: false,
		};
	}

	let verifyAst: Node;
	try {
		verifyAst = tokenize(fixed);
	} catch {
		return {
			safe: false,
			fixed: null,
			original: source,
			semanticChange: false,
		};
	}

	const verifyResult = analyze(verifyAst, { limit });

	if (!verifyResult.safe) {
		return {
			safe: false,
			fixed: null,
			original: source,
			semanticChange: false,
		};
	}

	return { safe: true, fixed, original: source, semanticChange: true };
}
