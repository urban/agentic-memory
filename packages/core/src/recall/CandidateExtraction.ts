import { cleanMarkup } from "./RecallText.ts";

type RecallCandidateOrigin = import("./RecallModel.ts").RecallCandidateOrigin;
type RecallLayer = import("./RecallModel.ts").RecallLayer;

type ExtractedCandidateText = {
  readonly text: string;
  readonly origin: RecallCandidateOrigin;
};

const sectionOrigin = (input: {
  readonly heading: string;
  readonly memoryLayer: RecallLayer;
  readonly isBullet: boolean;
  readonly text: string;
}): RecallCandidateOrigin => {
  const heading = input.heading.toLowerCase();
  const normalized = input.text.toLowerCase();
  if (
    heading === "routing" ||
    heading === "root routes" ||
    heading === "projects" ||
    heading === "next useful context" ||
    normalized.startsWith("read when:") ||
    (input.isBullet && input.text.includes("[["))
  ) {
    return "route";
  }
  if (heading === "resume context") {
    return "resume_context";
  }
  if (heading === "decision log") {
    return "decision_log";
  }
  if (input.memoryLayer === "map") {
    return "map_framing";
  }
  return "body";
};

export const extractBodyCandidates = (
  body: string,
  memoryLayer: RecallLayer,
): ReadonlyArray<ExtractedCandidateText> => {
  const candidates: Array<ExtractedCandidateText> = [];
  const paragraph: Array<string> = [];
  let heading = "";

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    const rawText = paragraph.join(" ");
    const text = cleanMarkup(rawText);
    if (text.length > 0) {
      candidates.push({
        text,
        origin: sectionOrigin({
          heading,
          memoryLayer,
          isBullet: false,
          text: rawText,
        }),
      });
    }
    paragraph.length = 0;
  };

  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line.length === 0) {
      flushParagraph();
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+)$/u);
    const headingText = headingMatch?.[1];
    if (headingText !== undefined) {
      flushParagraph();
      heading = cleanMarkup(headingText);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/u);
    const bullet = bulletMatch?.[1];
    if (bullet !== undefined) {
      flushParagraph();
      const text = cleanMarkup(bullet);
      if (text.length > 0) {
        candidates.push({
          text,
          origin: sectionOrigin({
            heading,
            memoryLayer,
            isBullet: true,
            text: bullet,
          }),
        });
      }
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();

  return candidates.filter(
    (candidate, index) =>
      candidates.findIndex(
        (other) => other.text === candidate.text && other.origin === candidate.origin,
      ) === index,
  );
};
