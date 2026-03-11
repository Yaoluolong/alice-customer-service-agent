import assert from "node:assert/strict";
import { parseReviewPayload } from "../nodes/responseReviewer";

export const runReviewerTests = (): void => {
  const valid = parseReviewPayload(
    JSON.stringify({
      score: 0.83,
      flags: ["ok"],
      reasons: ["looks good"],
      must_handoff: false
    })
  );

  assert.equal(valid.score, 0.83);
  assert.equal(valid.must_handoff, false);

  const fenced = parseReviewPayload("```json\n{\"score\":0.4,\"flags\":[\"x\"],\"reasons\":[\"y\"],\"must_handoff\":true}\n```");
  assert.equal(fenced.must_handoff, true);

  let failed = false;
  try {
    parseReviewPayload("not json");
  } catch {
    failed = true;
  }
  assert.equal(failed, true);
};
