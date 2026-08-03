import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { createClient } from "@libsql/client";
import { bundledVaultTemplatePath } from "@urban/agentic-memory-vault-template/VaultTemplatePackage";
import {
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  Path,
  PlatformError,
} from "effect";
import { prepareRecallEvidencePacket } from "../src/recall/EvidencePacket.ts";
import { isSafeRecallPublicText } from "../src/recall/EvidenceSafety.ts";
import { encodeRecallSuccessJson, recall } from "../src/recall/Recall.ts";
import {
  EvidenceEchoRecallSynthesisLayer,
  RecallSynthesis,
} from "../src/recall/RecallSynthesis.ts";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EmbeddingModel,
  EmbeddingRuntimeError,
  makeEmbeddingModel,
} from "../src/semantic/EmbeddingModel.ts";
import { synchronizeSemanticIndex } from "../src/semantic/SemanticIndex.ts";

interface EmbeddingControl {
  inputs: Array<string>;
  beforeEmbeddingResult?: Effect.Effect<void>;
  rejectEmbeddings?: boolean;
}

const vector = (first: number, second: number, third: number): ReadonlyArray<number> =>
  Array.from({ length: EMBEDDING_MODEL_DIMENSIONS }, (_, index) =>
    index === 0 ? first : index === 1 ? second : index === 2 ? third : 0,
  );

const embeddingFor = (input: string): ReadonlyArray<number> => {
  if (input.startsWith("task: search result | query:")) return vector(1, 0, 0);
  const evidenceRank = input.match(/evidence-rank-(\d+)/u)?.[1];
  if (evidenceRank !== undefined) return vector(1, Number(evidenceRank) / 100, 0);
  if (input.includes("route-only-nearest")) return vector(1, 0.01, 0);
  if (input.includes("safe-scrubbed-answer")) return vector(0.98, 0.2, 0);
  if (input.includes("substantive-map-answer")) return vector(0.96, 0.28, 0);
  if (input.includes("linked-route-answer")) return vector(0, 0, 1);
  if (input.includes("approved timeout is 640ms")) return vector(0.99, 0.1, 0);
  if (input.includes("recall timeout answer is 900ms")) return vector(0.2, 0.98, 0);
  if (input.includes("source-near-")) return vector(1, 0.01, 0);
  if (input.includes("eligible semantic fallback")) return vector(0.8, 0.6, 0);
  return vector(0, 0, 1);
};

const makeControlledEmbeddingLayer = (control: EmbeddingControl): Layer.Layer<EmbeddingModel> =>
  Layer.succeed(
    EmbeddingModel,
    makeEmbeddingModel({
      inspect: Effect.succeed({ status: "available", id: EMBEDDING_MODEL_ID }),
      install: Effect.succeed({ status: "already_available", id: EMBEDDING_MODEL_ID }),
      embed: (inputs) => {
        const result =
          control.rejectEmbeddings === true
            ? Effect.fail(
                new EmbeddingRuntimeError({ message: "Rejected query embedding for test" }),
              )
            : Effect.succeed(inputs.map(embeddingFor));
        return Effect.sync(() => control.inputs.push(...inputs)).pipe(
          Effect.andThen(control.beforeEmbeddingResult ?? Effect.void),
          Effect.andThen(result),
        );
      },
    }),
  );

const withRecallRuntime = <A, E, R>(
  control: EmbeddingControl,
  effect: Effect.Effect<A, E, R | EmbeddingModel | RecallSynthesis | BunServices.BunServices>,
) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      BunServices.layer,
      makeControlledEmbeddingLayer(control),
      EvidenceEchoRecallSynthesisLayer,
    ),
  );
  return runtime.contextEffect.pipe(
    Effect.flatMap((context) => Effect.provideContext(effect, context)),
    Effect.ensuring(runtime.disposeEffect),
  );
};

const initializeMinimalVault = Effect.fnUntraced(function* (vaultPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const templatePath = yield* bundledVaultTemplatePath();
  yield* fs.copy(templatePath, vaultPath, { overwrite: false });
  yield* fs.writeFileString(path.join(vaultPath, "MEMORY.md"), "# Memory\n");
  yield* fs.writeFileString(path.join(vaultPath, "USER.md"), "# User\n");
});

const executeSemanticIndexSql = Effect.fnUntraced(function* (vaultPath: string, sql: string) {
  const path = yield* Path.Path;
  const databaseUrl = yield* path.toFileUrl(
    path.join(vaultPath, ".agentic-memory", "index", "recall.db"),
  );
  yield* Effect.acquireUseRelease(
    Effect.sync(() => createClient({ url: databaseUrl.href })),
    (client) => Effect.promise(() => client.execute(sql)),
    (client) => Effect.sync(() => client.close()),
  );
});

const recallSingleAnswerDocument = Effect.fnUntraced(function* (
  control: EmbeddingControl,
  prefix: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vaultPath = yield* fs.makeTempDirectoryScoped({ prefix });
  yield* initializeMinimalVault(vaultPath);
  yield* fs.writeFileString(path.join(vaultPath, "notes", "answer.md"), content);
  yield* synchronizeSemanticIndex(vaultPath);
  control.inputs = [];
  return yield* recall({
    vaultPath,
    question: "What is the deployment timeout?",
  });
});

interface ProhibitedPublicOutputCase {
  readonly name: string;
  readonly answer: string;
  readonly claim: string;
  readonly providerModelIdentity?: "absent" | "present";
}

const prohibitedPublicOutputCases: ReadonlyArray<ProhibitedPublicOutputCase> = [
  {
    name: "the control-plane MEMORY_ADAPTER token in the answer",
    answer: "Use MEMORY_ADAPTER for the deployment details.",
    claim: "The deployment details are available.",
  },
  {
    name: "the control-plane MEMORY_ADAPTER token in the claim",
    answer: "The deployment details are available.",
    claim: "The MEMORY_ADAPTER contains the deployment details.",
  },
  {
    name: "underscore-delimited evidence metadata in the answer",
    answer: "The text_hash identifies the deployment evidence.",
    claim: "The deployment evidence is identified.",
  },
  {
    name: "underscore-delimited evidence metadata in the claim",
    answer: "The deployment evidence is identified.",
    claim: "The document_path identifies the deployment evidence.",
  },
  {
    name: "a bare relative document path in the answer",
    answer: "The deployment design is documented in design.md.",
    claim: "The deployment design has been documented.",
  },
  {
    name: "a capitalized dotted JavaScript document reference in the answer",
    answer: "Open Node.js for the deployment details.",
    claim: "The deployment design has been documented.",
  },
  {
    name: "an extensionless relative document path in the answer",
    answer: "The deployment decision is recorded in notes/alpha.",
    claim: "The deployment decision has been recorded.",
  },
  {
    name: "a relative path outside conventional memory directories in the answer",
    answer: "The deployment decision is recorded in private/alpha.",
    claim: "The deployment decision has been recorded.",
  },
  {
    name: "a generic relative path in arbitrary answer prose",
    answer: "The deployment decision appears in private/alpha before rollout.",
    claim: "The deployment decision has been documented.",
  },
  {
    name: "a generic relative path in arbitrary claim prose",
    answer: "The deployment decision has been documented.",
    claim: "The deployment decision appears in private/alpha.",
  },
  {
    name: "a generic relative path followed by terms in the answer",
    answer: "The deployment decision appears in private/alpha terms before rollout.",
    claim: "The deployment decision has been documented.",
  },
  {
    name: "a generic relative path followed by access in the claim",
    answer: "The policy grants limited access to operators.",
    claim: "The policy grants private/alpha access to operators.",
  },
  {
    name: "a prompt reference in the answer",
    answer: "The prompt says to use a 640ms deployment timeout.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "a prepositional prompt reference in the answer",
    answer: "According to the prompt, use a 640ms deployment timeout.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "an instruction-source prompt reference in the answer",
    answer: "The answer follows instructions from the prompt.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "an indefinite passive prompt source in the answer",
    answer: "The answer reflects instructions supplied by a prompt.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "provider details in the answer",
    answer: "The provider was OpenAI when the 640ms timeout was selected.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "unlisted provider details in the answer",
    answer: "The provider was Amazon Bedrock when the 640ms timeout was selected.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details preceding the provider descriptor in the answer",
    answer: "Amazon Bedrock was selected as the provider.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using serves as in the answer",
    answer: "Amazon Bedrock serves as the provider.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using served as in the answer",
    answer: "Amazon Bedrock served as the provider.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using served as after the descriptor in the answer",
    answer: "The provider served as Amazon Bedrock.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using served as after a newline in the answer",
    answer: "Deployment details:\nProvider served as Amazon Bedrock.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using is serving as in the answer",
    answer: "Amazon Bedrock is serving as the provider.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using is serving as after the descriptor in the answer",
    answer: "The provider is serving as Amazon Bedrock.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using has served as after the descriptor in the answer",
    answer: "The provider has served as Amazon Bedrock.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using will serve as in the answer",
    answer: "Amazon Bedrock will serve as the provider.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using will have served as after the descriptor in the answer",
    answer: "The provider will have served as Amazon Bedrock.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "article-prefixed model identity using served as in the answer",
    answer: "The model served as an OpenAI model.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "definite-article model identity using served as in the answer",
    answer: "The model served as the OpenAI service.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "lowercase provider identity using served as in the answer",
    answer: "The provider served as amazon bedrock.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "lowercase provider identity with a generic suffix in the answer",
    answer: "The provider served as amazon bedrock provider.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "lowercase model identity with a generic suffix in the answer",
    answer: "The model served as openai language model.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "model details in the answer",
    answer: "The model is gpt-4o and the deployment timeout is 640ms.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "unlisted model details in the answer",
    answer: "The model is Llama 3.1 70B and the deployment timeout is 640ms.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "model details preceding the model descriptor in the answer",
    answer: "Llama 3.1 70B was the selected model.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using serves as in the answer",
    answer: "Llama 3.1 70B serves as the model.",
    claim: "The deployment timeout is 640ms.",
    providerModelIdentity: "present",
  },
  {
    name: "trace details in the answer",
    answer: "Trace details show a 640ms deployment timeout.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "execution trace details in the answer",
    answer: "The execution trace shows a 640ms deployment timeout.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "prepositional execution trace details in the answer",
    answer: "The 640ms deployment timeout appears in the execution trace.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking diagnostics in the answer",
    answer: "Ranking diagnostics placed the 640ms timeout first.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking behavior in the answer",
    answer: "The ranking placed the 640ms timeout first.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "predicate ranking details in the answer",
    answer: "The 640ms deployment timeout ranked first during retrieval.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "retrieval-subject ranking details in the answer",
    answer: "Retrieval ranked the 640ms deployment timeout first.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "retrieval-subject placement ranking details in the answer",
    answer: "Retrieval placed the 640ms deployment timeout first.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "retrieval-subject ordering ranking details in the answer",
    answer: "Retrieval ordered the 640ms deployment timeout first.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "adverb-modified placed ranking details in the answer",
    answer: "Retrieval placed the 640ms deployment timeout first overall.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "adverb-modified ordered ranking details in the answer",
    answer: "Retrieval ordered the 640ms deployment timeout first chronologically.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "continued chronological ranking details in the answer",
    answer:
      "Retrieval placed the 640ms deployment timeout first chronologically among the candidates.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "continued overall ranking details in the answer",
    answer: "Retrieval placed the 640ms deployment timeout first overall before filtering.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "emphasis-formatted continued chronological ranking details in the answer",
    answer:
      "Retrieval placed the 640ms deployment timeout first **chronologically** among the candidates.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "emphasis-formatted continued overall ranking details in the answer",
    answer: "Retrieval placed the 640ms deployment timeout first _overall_ before filtering.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first overall before filtering.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "emphasis-formatted demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this **first** overall before filtering.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "split emphasis-formatted ranking adverb in the answer",
    answer: "Retrieval placed this first chrono**logically** among the candidates.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "code-formatted demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this `first` overall before filtering.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "split code-formatted ranking adverb in the answer",
    answer: "Retrieval placed this first chrono`logically` among the candidates.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "clause-final demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first overall.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "clause-final chronological demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first chronologically.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "clause-final ordinal-sequence demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first secondly.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "adverb-modified demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first chronologically among the candidates.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "locative demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first chronologically in the candidate list.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "secondly modified demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first secondly in the candidate list.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "recently modified demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first recently in the candidate list.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "result-scoped demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first recently in the results.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "option-scoped demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed this first recently within the options.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "shortlist-scoped demonstrative-pronoun ranking details in the answer",
    answer: "Retrieval placed that first secondly in the shortlist.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking details after a demonstrative ordinal noun phrase in the answer",
    answer: "Retrieval placed this first family in temporary housing first.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "coordinated placed ranking details in the answer",
    answer: "Retrieval placed the 640ms deployment timeout first and returned it.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "coordinated ordered ranking details in the answer",
    answer: "Retrieval ordered the 640ms deployment timeout first and returned it.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking details after an adjective noun object in the answer",
    answer: "Retrieval placed records with the user-selected labels highest.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking details after a restrictive relative clause in the answer",
    answer: "Retrieval placed the candidate the team preferred at the top.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking details after an after-prepositional noun phrase in the answer",
    answer: "Retrieval placed the candidate after the user-selected labels at the top.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking details after a before-prepositional noun phrase in the answer",
    answer: "Retrieval placed records before the archived candidates highest.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking details after an adjective noun phrase in the answer",
    answer: "Retrieval placed records before the eligible candidates highest.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking details after a compound noun phrase in the answer",
    answer: "Retrieval placed the notes before the archived project candidate records at the top.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "ranking details after an en-ending compound noun head in the answer",
    answer: "Retrieval placed records before the community garden highest.",
    claim: "The deployment timeout is 640ms.",
  },
  {
    name: "prohibited internal details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "According to the prompt, the deployment timeout is 640ms.",
  },
  {
    name: "an instruction-source prompt reference in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The prompt requested a 640ms deployment timeout.",
  },
  {
    name: "an indefinite passive prompt source in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The answer reflects instructions supplied by a prompt.",
  },
  {
    name: "provider identity details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The provider was Amazon Bedrock when the timeout was selected.",
    providerModelIdentity: "present",
  },
  {
    name: "model identity details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The model is Llama 3.1 70B.",
    providerModelIdentity: "present",
  },
  {
    name: "provider details using serves as in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Amazon Bedrock serves as the provider.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using serves as in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Llama 3.1 70B serves as the model.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using served as in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Llama 3.1 70B served as the model.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using served as after the descriptor in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The model served as Llama 3.1 70B.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using served as after a newline in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Deployment details:\nModel served as Llama 3.1 70B.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using is serving as in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Llama 3.1 70B is serving as the model.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using is serving as after the descriptor in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The model is serving as Llama 3.1 70B.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using has been serving as in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Llama 3.1 70B has been serving as the model.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using will be serving as after the descriptor in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The model will be serving as Llama 3.1 70B.",
    providerModelIdentity: "present",
  },
  {
    name: "model details using will have been serving as in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Llama 3.1 70B will have been serving as the model.",
    providerModelIdentity: "present",
  },
  {
    name: "article-prefixed provider identity using is serving as in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The provider is serving as an Amazon Bedrock provider.",
    providerModelIdentity: "present",
  },
  {
    name: "generic-modifier model identity using served as in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The model served as a hosted OpenAI service.",
    providerModelIdentity: "present",
  },
  {
    name: "lowercase identity after generic modifiers using served as in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The provider served as the selected amazon bedrock service.",
    providerModelIdentity: "present",
  },
  {
    name: "lowercase identity after an indefinite article and generic modifier in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "The provider served as a selected amazon bedrock service.",
    providerModelIdentity: "present",
  },
  {
    name: "retrieval-subject ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval ranked the 640ms deployment timeout first.",
  },
  {
    name: "retrieval-subject ordering details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval ordered the 640ms deployment timeout first.",
  },
  {
    name: "retrieval-subject placement details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed the 640ms deployment timeout first.",
  },
  {
    name: "adverb-modified placed ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed the 640ms deployment timeout first overall.",
  },
  {
    name: "adverb-modified ordered ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval ordered the 640ms deployment timeout first chronologically.",
  },
  {
    name: "continued chronological ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim:
      "Retrieval placed the 640ms deployment timeout first chronologically among the candidates.",
  },
  {
    name: "continued overall ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed the 640ms deployment timeout first overall before filtering.",
  },
  {
    name: "emphasis-formatted continued chronological ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim:
      "Retrieval placed the 640ms deployment timeout first **chronologically** among the candidates.",
  },
  {
    name: "emphasis-formatted continued overall ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed the 640ms deployment timeout first _overall_ before filtering.",
  },
  {
    name: "demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first overall before filtering.",
  },
  {
    name: "emphasis-formatted demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this **first** overall before filtering.",
  },
  {
    name: "split emphasis-formatted ranking adverb in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first chrono**logically** among the candidates.",
  },
  {
    name: "code-formatted demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this `first` overall before filtering.",
  },
  {
    name: "split code-formatted ranking adverb in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first chrono`logically` among the candidates.",
  },
  {
    name: "clause-final demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first overall.",
  },
  {
    name: "clause-final chronological demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first chronologically.",
  },
  {
    name: "clause-final ordinal-sequence demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first secondly.",
  },
  {
    name: "adverb-modified demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first chronologically among the candidates.",
  },
  {
    name: "locative demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first chronologically in the candidate list.",
  },
  {
    name: "secondly modified demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first secondly in the candidate list.",
  },
  {
    name: "recently modified demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first recently in the candidate list.",
  },
  {
    name: "result-scoped demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first recently in the results.",
  },
  {
    name: "option-scoped demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first recently within the options.",
  },
  {
    name: "shortlist-scoped demonstrative-pronoun ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed that first secondly in the shortlist.",
  },
  {
    name: "ranking details after a demonstrative ordinal noun phrase in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed this first family in temporary housing first.",
  },
  {
    name: "coordinated placed ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed the 640ms deployment timeout first and returned it.",
  },
  {
    name: "coordinated ordered ranking details in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval ordered the 640ms deployment timeout first and returned it.",
  },
  {
    name: "ranking details after an adjective noun object in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed records with the user-selected labels highest.",
  },
  {
    name: "ranking details after a restrictive relative clause in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed the candidate the team preferred at the top.",
  },
  {
    name: "ranking details after an after-prepositional noun phrase in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed the candidate after the user-selected labels at the top.",
  },
  {
    name: "ranking details after a before-prepositional noun phrase in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed records before the archived candidates highest.",
  },
  {
    name: "ranking details after an adjective noun phrase in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed records before the eligible candidates highest.",
  },
  {
    name: "ranking details after a compound noun phrase in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed the notes before the archived project candidate records at the top.",
  },
  {
    name: "ranking details after an en-ending compound noun head in the claim",
    answer: "Use a 640ms deployment timeout.",
    claim: "Retrieval placed records before the community garden highest.",
  },
];

describe("semantic recall", () => {
  it("preserves short lexical substrings when deduplicating evidence", () => {
    const packet = prepareRecallEvidencePacket([
      { documentPath: "notes/short.md", text: "not" },
      { documentPath: "notes/decision.md", text: "Deployment is not approved." },
    ]);

    assert.deepStrictEqual(packet.passages, [
      { id: "E1", text: "not" },
      { id: "E2", text: "Deployment is not approved." },
    ]);
  });

  it("rejects adversarial ranking text within a bounded duration", () => {
    const adversarialSubject = `${Array.from({ length: 8 }, () => "busy").join(" ")} team xyz`;
    const startedAt = performance.now();

    const isSafe = isSafeRecallPublicText(
      `Retrieval placed records before the ${adversarialSubject} highest.`,
    );
    const elapsedMilliseconds = performance.now() - startedAt;

    assert.isFalse(isSafe);
    assert.isBelow(elapsedMilliseconds, 250);
  });

  it.effect("returns one synthesized answer instead of rendering the evidence packet", () => {
    const control: EmbeddingControl = { inputs: [] };
    const synthesis = RecallSynthesis.of({
      synthesize: (input) => {
        assert.strictEqual(input.question, "What is the deployment timeout?");
        assert.strictEqual(input.evidence.passages[0]?.id, "E1");
        assert.include(input.evidence.passages[0]?.text ?? "", "640ms");
        return Effect.succeed({
          status: "answered",
          answer: "Use a 640ms deployment timeout.",
          claim: "The deployment timeout is 640ms.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        });
      },
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-synthesis-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, "Use a 640ms deployment timeout.");
        assert.notInclude(response.answer, "# Answer");
      }),
    );
  });

  it.effect(
    "fails grounding when synthesis references evidence outside the supplied packet",
    () => {
      const control: EmbeddingControl = { inputs: [] };
      const synthesis = RecallSynthesis.of({
        synthesize: () =>
          Effect.succeed({
            status: "answered",
            answer: "Use a 640ms deployment timeout.",
            claim: "The deployment timeout is 640ms.",
            evidenceIds: ["E99"],
            providerModelIdentity: "absent",
          }),
      });

      return withRecallRuntime(
        control,
        Effect.scoped(
          recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-unknown-evidence-",
            "# Answer\n\nThe approved deployment timeout is 640ms.\n",
          ).pipe(Effect.provideService(RecallSynthesis, synthesis), Effect.result),
        ),
      ).pipe(
        Effect.map((result) => {
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure._tag, "RecallError");
            if (result.failure._tag === "RecallError") {
              assert.strictEqual(result.failure.reason, "GroundingValidationFailed");
            }
          }
        }),
      );
    },
  );

  it.effect("fails grounding when an answered synthesis has no supporting evidence", () => {
    const control: EmbeddingControl = { inputs: [] };
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer: "Use a 640ms deployment timeout.",
          claim: "The deployment timeout is 640ms.",
          evidenceIds: [],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-missing-support-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis), Effect.result),
      ),
    ).pipe(
      Effect.map((result) => {
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure._tag, "RecallError");
          if (result.failure._tag === "RecallError") {
            assert.strictEqual(result.failure.reason, "GroundingValidationFailed");
          }
        }
      }),
    );
  });

  it.effect("rejects an unsafe claim while the answer remains safe", () => {
    const control: EmbeddingControl = { inputs: [] };
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer: "Use a 640ms deployment timeout.",
          claim: "According to the prompt, the deployment timeout is 640ms.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-unsafe-claim-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis), Effect.result),
      ),
    ).pipe(
      Effect.map((result) => {
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure._tag, "RecallError");
          if (result.failure._tag === "RecallError") {
            assert.strictEqual(result.failure.reason, "GroundingValidationFailed");
          }
        }
      }),
    );
  });

  it.effect.each(prohibitedPublicOutputCases)(
    "fails grounding before $name reaches public output",
    ({ answer, claim, providerModelIdentity = "absent" }) => {
      const control: EmbeddingControl = { inputs: [] };
      const synthesis = RecallSynthesis.of({
        synthesize: () =>
          Effect.succeed({
            status: "answered",
            answer,
            claim,
            evidenceIds: ["E1"],
            providerModelIdentity,
          }),
      });

      return withRecallRuntime(
        control,
        Effect.scoped(
          recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-public-leak-",
            "# Answer\n\nThe approved deployment timeout is 640ms.\n",
          ).pipe(Effect.provideService(RecallSynthesis, synthesis), Effect.result),
        ),
      ).pipe(
        Effect.map((result) => {
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure._tag, "RecallError");
            if (result.failure._tag === "RecallError") {
              assert.strictEqual(result.failure.reason, "GroundingValidationFailed");
            }
          }
        }),
      );
    },
  );

  it.effect("allows ordinary factual provider and model prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer: "The model was selected for its predictable timeout behavior.",
          claim: "The provider was selected based on geography.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-ordinary-provider-model-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(
          response.answer,
          "The model was selected for its predictable timeout behavior.",
        );
      }),
    );
  });

  it.effect.each([
    "The Gemini constellation is visible in winter.",
    "Mistral winds shape the local climate.",
    "Anthropic researches reliable artificial intelligence.",
    "Teams cohere around a shared goal.",
    "The project uses Node.js for command-line tools.",
  ])("allows ordinary factual prose: %s", (answer) => {
    const control: EmbeddingControl = { inputs: [] };
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: answer,
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-ordinary-fact-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect.each([
    "Retrieval placed the deployment note in the working context.",
    "Retrieval placed the first deployment note in the working context.",
    "Retrieval placed the first family in temporary housing.",
    "Retrieval placed the first assembly in the main hall.",
    "Retrieval placed another first family in temporary housing.",
    "Retrieval placed the very first family in temporary housing.",
    "Retrieval placed this first family in temporary housing.",
    "Retrieval placed that first assembly in the main hall.",
    "Retrieval placed this very first family in temporary housing.",
    "Retrieval placed this first family.",
    "Retrieval placed that first assembly.",
    "Retrieval placed this very first family.",
    "Retrieval placed this first family",
    "Retrieval placed that first assembly;",
    "Retrieval placed this very first family and sheltered them.",
    "Retrieval placed this first tally in the ledger.",
    "Retrieval placed this first rally in the schedule.",
    "Retrieval placed this **first family** in temporary housing.",
    "Retrieval placed this `first family` in temporary housing.",
    "Retrieval ordered the contacts by first name.",
    "Retrieval positioned the first note in the working context.",
    "Retrieval placed the note in context while the team reviewed the checklist first.",
    "Retrieval placed the note in context after the team reviewed the checklist first.",
    "Retrieval ordered the note after they reviewed the checklist first.",
    "Retrieval placed the note while Alice reviewed the checklist first.",
    "Retrieval placed the note while engineers reviewed the checklist first.",
    "Retrieval placed the note while she reviews the checklist first.",
    "Retrieval placed the note while the team is reviewing the checklist first.",
    "Retrieval placed the note while they will review the checklist first.",
    "Retrieval placed the note while the team arrived first.",
    "Retrieval placed the note while the busy team arrived first.",
    "Retrieval placed the note while the busy team ran first.",
    "Retrieval placed the note while the busy team reviews the checklist first.",
    "Retrieval placed the note after they finished last.",
    "Retrieval placed the note while Alice arrived first.",
    "Retrieval placed the note while engineers arrived first.",
  ])("allows ordinary non-ranking retrieval prose: %s", (answer) => {
    const control: EmbeddingControl = { inputs: [] };
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The requested information was available for the answer.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-ordinary-retrieval-",
          "# Answer\n\nThe requested information was available for the answer.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect.each([
    "Retrieval placed another first family in temporary housing.",
    "Retrieval placed the very first family in temporary housing.",
    "Retrieval placed this first family in temporary housing.",
    "Retrieval placed that first assembly in the main hall.",
    "Retrieval placed this very first family in temporary housing.",
    "Retrieval placed this first family.",
    "Retrieval placed that first assembly.",
    "Retrieval placed this very first family.",
    "Retrieval placed this first family",
    "Retrieval placed that first assembly;",
    "Retrieval placed this very first family and sheltered them.",
    "Retrieval placed this first tally in the ledger.",
    "Retrieval placed this first rally in the schedule.",
    "Retrieval placed this **first family** in temporary housing.",
    "Retrieval placed this `first family` in temporary housing.",
    "Retrieval placed the note while the team arrived first.",
    "Retrieval placed the note while the busy team arrived first.",
    "Retrieval placed the note while the busy team ran first.",
    "Retrieval placed the note while the busy team reviews the checklist first.",
    "Retrieval placed the note after they finished last.",
    "Retrieval placed the note while Alice arrived first.",
    "Retrieval placed the note while engineers arrived first.",
  ])("allows ordinary non-ranking retrieval prose in the independent claim: %s", (claim) => {
    const control: EmbeddingControl = { inputs: [] };
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer: "The requested information was available for the answer.",
          claim,
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-ordinary-ordinal-claim-",
          "# Answer\n\nThe requested information was available for the answer.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(
          response.answer,
          "The requested information was available for the answer.",
        );
      }),
    );
  });

  it.effect("allows an ordinary factual future-perfect-progressive serve-as role", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "The clinic will have been serving as the care provider.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The clinic has an established care role.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-future-perfect-progressive-role-",
          "# Answer\n\nThe clinic has an established care role.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows an object-first article-prefixed generic role in the answer", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "The clinic served as the provider.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The clinic fulfilled a provider role.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-object-first-role-answer-",
          "# Answer\n\nThe clinic fulfilled a provider role.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows an object-first article-prefixed generic role in the claim", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "The clinic fulfilled a provider role.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The clinic served as the provider.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-object-first-role-claim-",
          "# Answer\n\nThe clinic fulfilled a provider role.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("answers from indexed object-first generic serve-as evidence", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-object-first-role-evidence-",
          "# Answer\n\nThe clinic served as the provider.\n",
        ),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, "The clinic served as the provider.");
      }),
    );
  });

  it.effect("allows article-prefixed generic provider and model serve-as roles", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "The model served as a teaching aid.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The provider is serving as a fallback.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-generic-serve-as-role-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows bare generic serve-as roles after a sentence-initial descriptor", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "Model serves as backup.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The provider is serving as fallback.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-bare-generic-serve-as-role-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows numbered and hyphenated generic model and provider roles", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "The model served as a tier-2 statistical model.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The provider served as a 24-hour backup provider.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-numbered-generic-serve-as-role-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows an article-prefixed answer and a bare generic-role claim", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "The model served as an evaluation baseline.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "Provider served as local inference gateway.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-new-article-generic-role-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows a bare answer and an article-prefixed generic-role claim", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "Model serves as decision-support system.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The provider serves as a local inference gateway.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-new-bare-generic-role-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows bare two-word generic roles in answer and claim fields", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "The model served as evaluation baseline.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The provider served as operational safeguard.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-two-word-role-answer-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows a bare two-word generic role in the independent claim", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "The model served as comparison target.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The provider served as evaluation baseline.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-two-word-role-claim-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows ordinary multiline factual prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "Deployment details:\nUse a 640ms timeout for predictable behavior.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The deployment timeout is 640ms.\nIt keeps behavior predictable.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-ordinary-multiline-",
          "# Answer\n\nThe approved deployment timeout is 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("allows slash-delimited terms in ordinary factual prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    const answer = "The rollout strategy is documented in blue/green terms.";
    const synthesis = RecallSynthesis.of({
      synthesize: () =>
        Effect.succeed({
          status: "answered",
          answer,
          claim: "The rollout strategy uses blue and green terminology.",
          evidenceIds: ["E1"],
          providerModelIdentity: "absent",
        }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-slash-terms-",
          "# Answer\n\nThe rollout strategy uses blue and green terminology.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "answered");
        assert.strictEqual(response.answer, answer);
      }),
    );
  });

  it.effect("renders deterministic not_found wording when synthesis abstains", () => {
    const control: EmbeddingControl = { inputs: [] };
    const synthesis = RecallSynthesis.of({
      synthesize: () => Effect.succeed({ status: "not_found" }),
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-abstention-",
          "# Answer\n\nThe deployment timeout might be 640ms.\n",
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "not_found");
        assert.strictEqual(response.answer, "I don't know based on the available Agentic Memory.");
      }),
    );
  });

  it.effect("renders deterministic not_found wording for unresolved conflicting evidence", () => {
    const control: EmbeddingControl = { inputs: [] };
    const synthesis = RecallSynthesis.of({
      synthesize: (input) => {
        const evidence = input.evidence.passages.map(({ text }) => text).join("\n");
        assert.include(evidence, "640ms");
        assert.include(evidence, "900ms");
        return Effect.succeed({ status: "not_found" });
      },
    });

    return withRecallRuntime(
      control,
      Effect.scoped(
        recallSingleAnswerDocument(
          control,
          "agentic-memory-semantic-recall-conflict-abstention-",
          [
            "# Answer",
            "",
            "The approved deployment timeout is 640ms.",
            "The approved deployment timeout is 900ms.",
            "",
          ].join("\n"),
        ).pipe(Effect.provideService(RecallSynthesis, synthesis)),
      ),
    ).pipe(
      Effect.map((response) => {
        assert.strictEqual(response.status, "not_found");
        assert.strictEqual(response.answer, "I don't know based on the available Agentic Memory.");
      }),
    );
  });

  it.effect("answers from the current Markdown chunk instead of the indexed snippet", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-hydration-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "authoritative.md"),
            "# Authoritative\n\nThe current Markdown answer is 640ms.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          yield* executeSemanticIndexSql(
            vaultPath,
            "UPDATE chunks SET text = 'The private indexed snippet says 900ms.' WHERE document_path = 'notes/authoritative.md'",
          );
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the current Markdown answer?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, "The current Markdown answer is 640ms.");
        }),
      ),
    );
  });

  it.effect("fails when the selected ordinal is missing from current Markdown", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-missing-ordinal-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            "# Answer\n\nThe approved timeout is 640ms.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          yield* executeSemanticIndexSql(
            vaultPath,
            "UPDATE chunks SET ordinal = 99 WHERE document_path = 'notes/answer.md'",
          );
          control.inputs = [];

          const result = yield* recall({
            vaultPath,
            question: "What is the approved timeout?",
          }).pipe(Effect.result);

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "EvidenceHydrationFailed");
            assert.include(result.failure.message, "ordinal");
          }
        }),
      ),
    );
  });

  it.effect("fails when indexed provenance no longer matches current Markdown", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-provenance-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            "# Answer\n\nThe approved timeout is 640ms.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          yield* executeSemanticIndexSql(
            vaultPath,
            "UPDATE chunks SET text_hash = 'private-stale-provenance' WHERE document_path = 'notes/answer.md'",
          );
          control.inputs = [];

          const result = yield* recall({
            vaultPath,
            question: "What is the approved timeout?",
          }).pipe(Effect.result);

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "EvidenceHydrationFailed");
            assert.include(result.failure.message, "provenance");
          }
        }),
      ),
    );
  });

  it.effect("reports a managed Markdown read failure during hydration", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-hydration-failure-",
          });
          yield* initializeMinimalVault(vaultPath);
          const notePath = path.join(vaultPath, "notes", "answer.md");
          yield* fs.writeFileString(notePath, "# Answer\n\nThe approved timeout is 640ms.\n");
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          let answerReads = 0;
          const permissionDenied = PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "readFileString",
            pathOrDescriptor: notePath,
          });
          const hydrationFailureFileSystem = FileSystem.FileSystem.of({
            ...fs,
            readFileString: (entryPath, encoding) => {
              if (entryPath !== notePath) return fs.readFileString(entryPath, encoding);
              answerReads += 1;
              return answerReads === 3
                ? Effect.fail(permissionDenied)
                : fs.readFileString(entryPath, encoding);
            },
          });

          const result = yield* recall({
            vaultPath,
            question: "What is the approved timeout?",
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, hydrationFailureFileSystem),
            Effect.result,
          );

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "EvidenceHydrationFailed");
            assert.strictEqual(
              result.failure.message,
              "Failed to hydrate current Agentic Memory evidence",
            );
          }
        }),
      ),
    );
  });

  it.effect("preserves exact-cosine order in the interim evidence answer", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-nearest-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "semantic-winner.md"),
            "# Semantic winner\n\nThe approved timeout is 640ms.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "lexical-distractor.md"),
            "# Lexical distractor\n\nThe recall timeout answer is 900ms.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const question = "What is the recall timeout answer?";
          const response = yield* recall({ vaultPath, question });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            ["The approved timeout is 640ms.", "The recall timeout answer is 900ms."].join("\n\n"),
          );
          assert.deepStrictEqual(control.inputs, [
            "task: search result | query: What is the recall timeout answer?",
          ]);
        }),
      ),
    );
  });

  it.effect("keeps query embedding failures distinct from semantic search failures", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-query-failure-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            "# Answer\n\nThe indexed answer remains searchable.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];
          control.rejectEmbeddings = true;

          const question = "What is the indexed answer?";
          const result = yield* recall({ vaultPath, question }).pipe(Effect.result);

          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "QueryEmbeddingFailed");
            assert.strictEqual(result.failure.message, "Failed to embed the recall question");
          }
          assert.deepStrictEqual(control.inputs, [
            "task: search result | query: What is the indexed answer?",
          ]);
        }),
      ),
    );
  });

  it.effect("reports a search failure after readiness and query embedding succeed", () =>
    Effect.gen(function* () {
      const queryEmbeddingStarted = yield* Deferred.make<void>();
      const continueQueryEmbedding = yield* Deferred.make<void>();
      const control: EmbeddingControl = { inputs: [] };
      return yield* withRecallRuntime(
        control,
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const vaultPath = yield* fs.makeTempDirectoryScoped({
              prefix: "agentic-memory-semantic-recall-search-failure-",
            });
            yield* initializeMinimalVault(vaultPath);
            yield* fs.writeFileString(
              path.join(vaultPath, "notes", "answer.md"),
              "# Answer\n\nThe indexed answer remains searchable.\n",
            );
            yield* synchronizeSemanticIndex(vaultPath);
            control.inputs = [];
            control.beforeEmbeddingResult = Deferred.succeed(queryEmbeddingStarted, undefined).pipe(
              Effect.andThen(Deferred.await(continueQueryEmbedding)),
            );

            const question = "What is the indexed answer?";
            const recallFiber = yield* recall({
              vaultPath,
              question,
            }).pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
            yield* Deferred.await(queryEmbeddingStarted);
            yield* fs.remove(path.join(vaultPath, ".agentic-memory", "index"), {
              recursive: true,
            });
            yield* Deferred.succeed(continueQueryEmbedding, undefined);
            const result = yield* Fiber.join(recallFiber);

            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.strictEqual(result.failure.reason, "SemanticSearchFailed");
              assert.strictEqual(result.failure.message, "Failed to search Agentic Memory");
            }
            assert.deepStrictEqual(control.inputs, [
              "task: search result | query: What is the indexed answer?",
            ]);
          }),
        ),
      );
    }),
  );

  it.effect("rejects an indexed chunk after managed memory changes during embedding", () =>
    Effect.gen(function* () {
      const queryEmbeddingStarted = yield* Deferred.make<void>();
      const continueQueryEmbedding = yield* Deferred.make<void>();
      const control: EmbeddingControl = { inputs: [] };
      return yield* withRecallRuntime(
        control,
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const vaultPath = yield* fs.makeTempDirectoryScoped({
              prefix: "agentic-memory-semantic-recall-stale-during-query-",
            });
            yield* initializeMinimalVault(vaultPath);
            const notePath = path.join(vaultPath, "notes", "answer.md");
            yield* fs.writeFileString(
              notePath,
              "# Answer\n\nThe obsolete indexed answer is 640ms.\n",
            );
            yield* synchronizeSemanticIndex(vaultPath);
            control.inputs = [];
            control.beforeEmbeddingResult = Deferred.succeed(queryEmbeddingStarted, undefined).pipe(
              Effect.andThen(Deferred.await(continueQueryEmbedding)),
            );

            const recallFiber = yield* recall({
              vaultPath,
              question: "What is the indexed answer?",
            }).pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
            yield* Deferred.await(queryEmbeddingStarted);
            yield* fs.writeFileString(notePath, "# Answer\n\nThe current answer is 900ms.\n");
            yield* Deferred.succeed(continueQueryEmbedding, undefined);
            const result = yield* Fiber.join(recallFiber);

            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.strictEqual(result.failure.reason, "SemanticIndexStale");
            }
          }),
        ),
      );
    }),
  );

  it.effect("excludes sources before selecting the top ten eligible chunks", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-source-budget-",
          });
          yield* initializeMinimalVault(vaultPath);
          for (let index = 0; index < 10; index += 1) {
            yield* fs.writeFileString(
              path.join(vaultPath, "sources", `near-${index}.md`),
              `# Source ${index}\n\nsource-near-${index} must not be recalled.\n`,
            );
          }
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "eligible.md"),
            "# Eligible\n\nThe eligible semantic fallback is the public answer.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const question = "Which indexed memory is the answer?";
          const response = yield* recall({ vaultPath, question });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The eligible semantic fallback is the public answer.",
          );
        }),
      ),
    );
  });

  it.effect("skips route-only passages without expanding their links", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-route-only-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "maps", "routes.md"),
            [
              "# Routes",
              "",
              "- [[notes/linked-answer]] — route-only-nearest. Read when: answering the question.",
              "",
            ].join("\n"),
          );
          for (let index = 0; index < 8; index += 1) {
            yield* fs.writeFileString(
              path.join(vaultPath, "maps", `routes-${index}.md`),
              `# Routes ${index}\n\nRead the route-only-nearest map document for routing.\n`,
            );
          }
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "linked-answer.md"),
            "# Linked answer\n\nThe linked-route-answer must not be expanded from the route.\n",
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "eligible.md"),
            "# Eligible\n\nThe eligible semantic fallback is the public answer.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the public answer?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The eligible semantic fallback is the public answer.",
          );
        }),
      ),
    );
  });

  it.effect("scrubs wikilinks and Markdown routing syntax", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-link-scrub-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout.",
              "",
              "- [[notes/private-runbook]] — internal route. Read when: deploying.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "[[");
          assert.notInclude(encoded, "Read when:");
        }),
      ),
    );
  });

  it.effect("scrubs relative and absolute document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-path-scrub-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout.",
              "",
              "The relative document path is notes/private-runbook.md.",
              "",
              "The absolute document path is /Users/example/private-runbook.md.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "notes/");
          assert.notInclude(encoded, "/Users/");
        }),
      ),
    );
  });

  it.effect("scrubs generic document paths while preserving safe prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-generic-relative-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. See docs/private-runbook.md for details. The private runbook is at /srv/deploy/private-runbook.txt.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook.md");
          assert.notInclude(encoded, "/srv/deploy/private-runbook.txt");
        }),
      ),
    );
  });

  it.effect("scrubs adjacent inline-code absolute paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-adjacent-inline-code-path-",
            ["# Answer", "", "The safe-scrubbed-answer is safe. Use`/private/runbook`.", ""].join(
              "\n",
            ),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, "The safe-scrubbed-answer is safe.");
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "/private/runbook");
        }),
      ),
    );
  });

  it.effect("scrubs relative document paths regardless of file extension", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-relative-document-path-extension-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. See docs/private-runbook.txt for details. Open config/secrets.yaml for deployment credentials.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook.txt");
          assert.notInclude(encoded, "config/secrets.yaml");
        }),
      ),
    );
  });

  it.effect("scrubs extensionless relative document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-extensionless-relative-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. See docs/private-runbook for details.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs extensionless document paths introduced by consult", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-consult-extensionless-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Consult docs/private-runbook before rollout.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs extensionless document paths in ordinary prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-extensionless-ordinary-prose-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer supports read/write access, and operators deploy using blue/green releases. The deployment runbook location is docs/private-runbook. The deployment runbook is located at docs/private-runbook. Deploy using docs/runbook.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer supports read/write access, and operators deploy using blue/green releases.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
          assert.notInclude(encoded, "docs/runbook");
        }),
      ),
    );
  });

  it.effect("scrubs colon-labeled extensionless document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-colon-extensionless-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Deployment runbook: docs/private-runbook.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs colon-labeled extensionless paths before trailing prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-colon-path-trailing-prose-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Deployment runbook: docs/private-runbook; operators review it before rollout.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs colon-labeled bare document filenames", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-colon-bare-filename-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Deployment runbook: private-runbook.md.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "private-runbook.md");
        }),
      ),
    );
  });

  it.effect("scrubs inline-code extensionless document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-inline-code-extensionless-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. The deployment runbook is located at `docs/private-runbook`.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs emphasized colon-labeled inline-code document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-emphasized-colon-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. **Deployment runbook:** **`docs/private-runbook`**.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("scrubs multi-backtick extensionless document paths", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-multi-backtick-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. The deployment runbook is located at ``docs/private-runbook``.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "docs/private-runbook");
        }),
      ),
    );
  });

  it.effect("preserves inline ordered prose while removing physical list prefixes", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer =
            "The rollout has two phases. 1) Prepare the cluster. 2) Deploy the service.";
          const inlineResponse = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-inline-ordered-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(inlineResponse.status, "answered");
          assert.strictEqual(inlineResponse.answer, answer);

          const listResponse = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-ordered-list-prefix-",
            ["# Answer", "", `1) ${answer}`, ""].join("\n"),
          );

          assert.strictEqual(listResponse.status, "answered");
          assert.strictEqual(listResponse.answer, answer);
        }),
      ),
    );
  });

  it.effect("preserves substantive slash-delimited prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer =
            "The safe-scrubbed-answer supports read/write access, blue/green deployment, 24/7 coverage, the 2026/07/30 release date, and 100 requests/second.";
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-slash-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, answer);
        }),
      ),
    );
  });

  it.effect("preserves slash prose near document terms", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer =
            "The safe-scrubbed-answer document format is read/write access. The file mode is read/write.";
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-document-slash-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, answer);
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.include(encoded, "read/write");
        }),
      ),
    );
  });

  it.effect("scrubs dot-relative document paths while preserving safe prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-dot-relative-path-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Open ./private-runbook.md for details.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "./private-runbook.md");
        }),
      ),
    );
  });

  it.effect("scrubs ordinary provider and model labels while preserving safe prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-provider-model-label-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. Provider: Anthropic. Model: gpt-4o.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "Anthropic");
          assert.notInclude(encoded, "gpt-4o");
        }),
      ),
    );
  });

  it.effect("scrubs reference-style Markdown links while preserving safe prose", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-reference-link-",
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout. See [private runbook][runbook].",
              "",
              "[runbook]: docs/private-runbook.md",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "[private runbook][runbook]");
          assert.notInclude(encoded, "[runbook]:");
        }),
      ),
    );
  });

  it.effect("scrubs control-plane names from the public response", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-control-plane-scrub-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout.",
              "",
              "Internal control-plane file: .agentic-memory/LLM-vault-local.md.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, ".agentic-memory");
          assert.notInclude(encoded, "LLM-vault-local");
        }),
      ),
    );
  });

  it.effect("scrubs evidence, provider, and model implementation details", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-metadata-scrub-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "answer.md"),
            [
              "# Answer",
              "",
              "The safe-scrubbed-answer is a 640ms deployment timeout.",
              "",
              "Evidence ID E1 has vector score 0.998 and ordinal 4.",
              "",
              "Provider detail: llama-server. Model detail: agentic-memory-qwen3-4b.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer is a 640ms deployment timeout.",
          );
          const encoded = yield* encodeRecallSuccessJson(response);
          assert.notInclude(encoded, "Evidence ID");
          assert.notInclude(encoded, "vector score");
          assert.notInclude(encoded, "llama-server");
          assert.notInclude(encoded, "qwen");
        }),
      ),
    );
  });

  it.effect("keeps substantive root and map prose eligible after scrubbing", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-map-prose-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "MEMORY.md"),
            [
              "# Memory",
              "",
              "The substantive-map-answer is a 640ms deployment timeout.",
              "",
              "- [[maps/deployments]] — deployment routes. Read when: deploying.",
              "",
            ].join("\n"),
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What is the deployment timeout?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The substantive-map-answer is a 640ms deployment timeout.",
          );
        }),
      ),
    );
  });

  it.effect("returns not_found when no eligible semantic chunk exists", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-no-eligible-hit-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "sources", "only-hit.md"),
            "# Only indexed hit\n\nsource-near-only must remain ineligible.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);

          const question = "What eligible memory answers this question?";
          const response = yield* recall({ vaultPath, question });

          assert.deepStrictEqual(response, {
            status: "not_found",
            question,
            answer: "I don't know based on the available Agentic Memory.",
            warnings: [],
          });
        }),
      ),
    );
  });

  it.effect("preserves inline-code slash prose in document contexts", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer = "The safe-scrubbed-answer document is available in `read/write` mode.";
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-inline-code-slash-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            "The safe-scrubbed-answer document is available in read/write mode.",
          );
        }),
      ),
    );
  });

  it.effect("preserves colon-labeled slash prose in location contexts", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const answer = "The safe-scrubbed-answer uses a deployment location: blue/green.";
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-colon-labeled-slash-prose-",
            ["# Answer", "", answer, ""].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, answer);
        }),
      ),
    );
  });

  it.effect("keeps semantic order while limiting interim evidence to five documents", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-evidence-order-",
          });
          yield* initializeMinimalVault(vaultPath);
          for (let rank = 1; rank <= 6; rank += 1) {
            yield* fs.writeFileString(
              path.join(vaultPath, "notes", `evidence-${rank}.md`),
              `# evidence-rank-${rank}\n\nThe ranked evidence passage is ${rank}.\n`,
            );
          }
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What are the ranked evidence passages?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            Array.from(
              { length: 5 },
              (_, index) => `The ranked evidence passage is ${index + 1}.`,
            ).join("\n\n"),
          );
        }),
      ),
    );
  });

  it.effect("selects at most two interim passages from one document", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-document-budget-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "primary.md"),
            [1, 2, 3]
              .map(
                (rank) =>
                  `# evidence-rank-${rank}\n\nThe primary document evidence passage is ${rank}.\n`,
              )
              .join("\n"),
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "secondary.md"),
            "# evidence-rank-4\n\nThe secondary document evidence passage is 4.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "What are the document-budget evidence passages?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            [
              "The primary document evidence passage is 1.",
              "The primary document evidence passage is 2.",
              "The secondary document evidence passage is 4.",
            ].join("\n\n"),
          );
        }),
      ),
    );
  });

  it.effect("deduplicates repeated and overlapping interim passages", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-evidence-deduplication-",
          });
          yield* initializeMinimalVault(vaultPath);
          const firstPassage =
            "The first ranked fact is retained. The shared boundary fact appears once.";
          const documents: ReadonlyArray<readonly [number, string]> = [
            [1, firstPassage],
            [2, "The shared boundary fact appears once. The second ranked fact is also retained."],
            [3, firstPassage],
          ];
          for (const [rank, passage] of documents) {
            yield* fs.writeFileString(
              path.join(vaultPath, "notes", `deduplication-${rank}.md`),
              `# evidence-rank-${rank}\n\n${passage}\n`,
            );
          }
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "Which deduplicated facts should be retained?",
          });

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(
            response.answer,
            [firstPassage, "The second ranked fact is also retained."].join("\n\n"),
          );
        }),
      ),
    );
  });

  it.effect("deduplicates repeated facts within one interim passage", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* recallSingleAnswerDocument(
            control,
            "agentic-memory-semantic-recall-internal-evidence-deduplication-",
            [
              "# evidence-rank-1",
              "",
              "- The repeated packet fact appears once.",
              "- The repeated packet fact appears once.",
              "- The repeated packet fact appears once.",
              "",
            ].join("\n"),
          );

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, "The repeated packet fact appears once.");
        }),
      ),
    );
  });

  it.effect("omits passages that would exceed the interim evidence token budget", () => {
    const control: EmbeddingControl = { inputs: [] };
    return withRecallRuntime(
      control,
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const vaultPath = yield* fs.makeTempDirectoryScoped({
            prefix: "agentic-memory-semantic-recall-evidence-token-budget-",
          });
          yield* initializeMinimalVault(vaultPath);
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "oversized.md"),
            `# evidence-rank-1\n\n${"x".repeat(18_004)}\n`,
          );
          yield* fs.writeFileString(
            path.join(vaultPath, "notes", "bounded.md"),
            "# evidence-rank-2\n\nThe bounded evidence passage remains available.\n",
          );
          yield* synchronizeSemanticIndex(vaultPath);
          control.inputs = [];

          const response = yield* recall({
            vaultPath,
            question: "Which evidence fits the packet budget?",
          });
          const encoded = yield* encodeRecallSuccessJson(response);

          assert.strictEqual(response.status, "answered");
          assert.strictEqual(response.answer, "The bounded evidence passage remains available.");
          assert.notInclude(encoded, "E1");
          assert.notInclude(encoded, vaultPath);
        }),
      ),
    );
  });
});
