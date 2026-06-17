"use strict";

// Pure text helpers shared by the stage-2 renderers. Kept dependency-free
// (Node built-ins only) and side-effect-free so they can be unit-tested.

/**
 * Drop a leading concept label from an evidence/proof line.
 *
 * The strongest evidence line is often a raw deck excerpt that repeats the
 * concept label at the front — e.g. the finding titled "EDC Blueprint Page"
 * has the proof line "EDC Blueprint Users understand the Enterprise Data Cloud
 * category…". That prefix is redundant with the finding heading and reads as a
 * duplicated subject. This removes a leading run of words that matches the
 * start of `title` (in order), so EVIDENCE reads as the statement alone.
 *
 * Conservative by design: it only strips when at least two leading words match
 * the title, so a single coincidental word ("Platform messaging…" under a
 * "Platform Diagram Update" finding) is never truncated. Returns `text`
 * unchanged when nothing qualifies, and never returns an empty string.
 *
 * @param {string} text  evidence/proof text, possibly label-prefixed
 * @param {string} title finding title to strip from the front of `text`
 * @returns {string}
 */
function stripLeadingConceptLabel(text, title) {
  if (!text || !title) return text;
  const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "");
  const titleWords = title.split(/\s+/).map(norm).filter(Boolean);
  if (!titleWords.length) return text;

  // Tokenize the leading words of `text`, remembering where each token ends so
  // we can slice the original string (preserving its spacing/punctuation).
  const tokens = [];
  const re = /\S+\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) tokens.push({ end: re.lastIndex, norm: norm(m[0]) });

  let matched = 0;
  let cut = 0;
  while (
    matched < tokens.length &&
    matched < titleWords.length &&
    tokens[matched].norm &&
    tokens[matched].norm === titleWords[matched]
  ) {
    cut = tokens[matched].end;
    matched += 1;
  }

  // Require a >=2-word label match to avoid stripping a coincidental first word.
  if (matched < 2) return text;
  const rest = text.slice(cut).replace(/^\s+/, "");
  if (!rest) return text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

module.exports = { stripLeadingConceptLabel };
