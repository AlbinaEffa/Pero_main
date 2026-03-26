/**
 * Word-level diff utility.
 * Computes the difference between two strings at the word granularity
 * using the Longest Common Subsequence algorithm.
 */

export type DiffKind = 'equal' | 'removed' | 'added';

export interface DiffToken {
  kind: DiffKind;
  text: string;
}

/** Split text into tokens: alternating word and whitespace chunks. */
function tokenize(text: string): string[] {
  // Split on whitespace boundaries, keeping whitespace as separate tokens
  return text.split(/(\s+)/).filter(t => t.length > 0);
}

/** Build LCS table for two token arrays. */
function buildLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/** Backtrack through the LCS table to produce diff tokens. */
function backtrack(dp: number[][], a: string[], b: string[], i: number, j: number, result: DiffToken[]): void {
  if (i === 0 && j === 0) return;
  if (i === 0) {
    backtrack(dp, a, b, i, j - 1, result);
    result.push({ kind: 'added', text: b[j - 1] });
  } else if (j === 0) {
    backtrack(dp, a, b, i - 1, j, result);
    result.push({ kind: 'removed', text: a[i - 1] });
  } else if (a[i - 1] === b[j - 1]) {
    backtrack(dp, a, b, i - 1, j - 1, result);
    result.push({ kind: 'equal', text: a[i - 1] });
  } else if (dp[i - 1][j] >= dp[i][j - 1]) {
    backtrack(dp, a, b, i - 1, j, result);
    result.push({ kind: 'removed', text: a[i - 1] });
  } else {
    backtrack(dp, a, b, i, j - 1, result);
    result.push({ kind: 'added', text: b[j - 1] });
  }
}

/**
 * Compute word-level diff between `prev` and `next`.
 * Returns tokens tagged as 'equal', 'removed', or 'added'.
 * Whitespace tokens are kept to preserve formatting but are always 'equal'.
 */
export function wordDiff(prev: string, next: string): DiffToken[] {
  const a = tokenize(prev);
  const b = tokenize(next);

  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return b.map(t => ({ kind: 'added', text: t }));
  if (b.length === 0) return a.map(t => ({ kind: 'removed', text: t }));

  // For very large inputs, fall back to whole-string diff to avoid stack overflow
  if (a.length + b.length > 600) {
    return [
      { kind: 'removed', text: prev },
      { kind: 'added', text: next },
    ];
  }

  const dp = buildLCS(a, b);
  const result: DiffToken[] = [];
  backtrack(dp, a, b, a.length, b.length, result);

  // Whitespace tokens between same-kind content: treat as equal
  return result.map(token => {
    if (/^\s+$/.test(token.text)) return { kind: 'equal', text: token.text };
    return token;
  });
}
