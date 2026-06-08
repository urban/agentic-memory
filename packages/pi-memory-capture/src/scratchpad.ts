import {
  CANDIDATE_REASON_CHAR_LIMIT,
  CANDIDATE_SUMMARY_CHAR_LIMIT,
  SCRATCHPAD_CANDIDATE_LIMIT,
  TRUNCATION_SUFFIX,
} from "./constants.ts";
import { Scratchpad } from "./schema.js";
import { truncateWithSuffix } from "./text.ts";

export const emptyScratchpad = (projectLink: string, updatedAt: string) =>
  Scratchpad.make({
    version: 1,
    projectLink,
    updatedAt,
    pendingCandidates: [],
  });

export const boundScratchpad = (scratchpad: Scratchpad, updatedAt: string) =>
  Scratchpad.make({
    ...scratchpad,
    updatedAt,
    pendingCandidates: scratchpad.pendingCandidates
      .slice(0, SCRATCHPAD_CANDIDATE_LIMIT)
      .map((candidate) => ({
        ...candidate,
        summary: truncateWithSuffix(
          candidate.summary,
          CANDIDATE_SUMMARY_CHAR_LIMIT,
          TRUNCATION_SUFFIX,
        ),
        reasonNotPromoted: truncateWithSuffix(
          candidate.reasonNotPromoted,
          CANDIDATE_REASON_CHAR_LIMIT,
          TRUNCATION_SUFFIX,
        ),
      })),
  });
