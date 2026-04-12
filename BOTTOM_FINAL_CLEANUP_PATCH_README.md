Apply this micro-patch if the default newsletter still has:
- repeated "What we found" and "Proof point" text for the same concept
- duplicate or near-duplicate knowledge portal actions at the bottom
- repeated items in the final "What we should do next" rollup

This patch adds a post-generation cleanup step that:
1. blanks out Proof point when it is identical to What we found
2. deduplicates the final action rollup
3. merges multiple knowledge portal actions into one combined action
4. rewrites default.html/default.md/default.json from the cleaned result
