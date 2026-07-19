export type RecallLayer =
  | "core"
  | "user"
  | "map"
  | "project"
  | "note"
  | "person"
  | "record"
  | "source";

export type RecallDocument = {
  readonly path: string;
  readonly memoryLayer: RecallLayer;
  readonly content: string;
};

export type RecallContentStatus = "draft" | "active" | "stale" | "archived";
export type RecallProjectStatus = "candidate" | "active" | "completed" | "archived";

export type ParsedRecallDocument = RecallDocument & {
  readonly body: string;
  readonly title: string;
  readonly declaredType: RecallLayer | undefined;
  readonly status: RecallContentStatus | undefined;
  readonly projectStatus: RecallProjectStatus | undefined;
  readonly summary: string | undefined;
  readonly aliases: ReadonlyArray<string>;
  readonly metadataTokens: ReadonlyArray<string>;
};

export type ProjectEntity = {
  readonly key: string;
  readonly labelTokenSets: ReadonlyArray<ReadonlyArray<string>>;
  readonly distinctiveTokens: ReadonlyArray<string>;
};

export type RecallCandidateOrigin =
  | "summary"
  | "body"
  | "map_framing"
  | "resume_context"
  | "decision_log"
  | "route";

export type RouteEntry = {
  readonly path: string;
  readonly tokens: ReadonlyArray<string>;
  readonly linkedTargets: ReadonlyArray<string>;
  readonly projectKeys: ReadonlyArray<string>;
};

export type RouteExpansion = {
  readonly boost: number;
  readonly tokens: ReadonlyArray<string>;
  readonly projectKeys: ReadonlyArray<string>;
};

export type RecallCandidate = {
  readonly path: string;
  readonly memoryLayer: RecallLayer;
  readonly text: string;
  readonly tokens: ReadonlyArray<string>;
  readonly metadataTokens: ReadonlyArray<string>;
  readonly projectKeys: ReadonlyArray<string>;
  readonly status: RecallContentStatus | undefined;
  readonly projectStatus: RecallProjectStatus | undefined;
  readonly score: number;
  readonly origin: RecallCandidateOrigin;
  readonly routeBoost: number;
};

export type QuestionAnalysis = {
  readonly tokens: ReadonlyArray<string>;
  readonly selectedProjectKeys: ReadonlyArray<string>;
  readonly selectedEntityTokens: ReadonlyArray<string>;
  readonly projectTopicTokens: ReadonlyArray<string>;
  readonly optionTopicTokens: ReadonlyArray<string>;
  readonly wantsProjectFact: boolean;
  readonly wantsOptionPreference: boolean;
  readonly wantsSourceEvidence: boolean;
  readonly wantsRationale: boolean;
  readonly wantsResumeContext: boolean;
};

export type CandidateDraft = Omit<RecallCandidate, "score">;

export type SupportedCandidate = {
  readonly candidate: RecallCandidate;
  readonly supportScore: number;
};

export type AnswerPart = {
  readonly category: "project_fact" | "user_preference";
  readonly sentence: string;
};
