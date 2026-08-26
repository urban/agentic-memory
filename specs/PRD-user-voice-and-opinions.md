# PRD: User Voice and Opinions in `USER.md`

## Status

Approved specification.

The user approved these product decisions:

- voice information belongs in a dedicated section inside root `USER.md`;
- opinion information belongs in a dedicated section inside root `USER.md`;
- the canonical order is Profile → Communication → Voice → Opinions → Glossary → Preferences and working patterns → Inferred preferences → Related notes;
- Explicit and Repeated entries may become normative defaults; Observed and Inferred entries remain candidates;
- the existing `USER.md` budget remains unchanged;
- opinions require evidence-aware attribution and visible correction when materially revised;
- Agentic Memory must not introduce or require separate root `VOICE.md`, `OPINION.md`, or `OPINIONS.md` files;
- this feature introduces no versioned consolidation or compatibility work for separate files because those files have never been part of the Agentic Memory contract.

## Summary

Agentic Memory already treats `USER.md` as always-loaded, lean owner context for stable facts, communication preferences, glossary terms, and working patterns. This change makes two important kinds of owner context explicit:

1. **Voice** — how an agent should communicate, especially when drafting client-facing or user-authored material.
2. **Opinions** — current, evidence-backed, revisable user preferences and subjective judgments about how an agent should analyze choices and make recommendations.

The canonical `USER.md` body gains exactly these sections:

```md
## Voice

## Opinions
```

They remain part of `type: user`; this change adds no managed-memory type, frontmatter field, folder, or independent startup file. Agents already read `USER.md` during startup, so voice and opinions become available without another always-loaded document or another routing hop.

The feature must preserve Agentic Memory’s existing constraints:

- `USER.md` stays lean and pointer-heavy;
- current user instructions and project-specific decisions outrank durable defaults;
- human authorship and confidence are explicit;
- assistant proposals do not become user opinions through silence;
- sensitive traits and private worldview must not be inferred;
- detailed rationale and cross-project evidence belong in linked notes, records, or sources rather than expanding `USER.md` indefinitely.

## Problem

The current `USER.md` contract has broad sections for `Communication` and `Preferences and working patterns`, but it does not distinguish:

- interaction mechanics from authored voice;
- ordinary working preferences from analytical opinions that shape judgment;
- revisable owner guidance from project facts, requirements, values, and procedures;
- normative user-endorsed defaults from lower-confidence observations.

Without explicit ownership, agents may:

- scatter voice guidance across `USER.md`, notes, project files, and ad hoc root files;
- create separate `VOICE.md` or `OPINIONS.md` documents and add unnecessary startup context;
- treat a one-off formatting request as a global voice rule;
- promote an assistant recommendation into a user opinion without acceptance;
- apply a project-specific gate as a universal owner opinion;
- recast a value, internal conviction, fact, or procedure as an opinion;
- remember tone while losing the evidence and rationale that should guide future work;
- load voice and opinions inconsistently because their locations are not canonical.

The result is duplicated memory, unclear authority, and avoidable drift between how agents communicate and how they decide.

## Goal

Make `USER.md` the single canonical always-loaded home for compact, durable owner voice and opinion guidance.

After this change, an agent should be able to read `USER.md` and answer:

- How should I communicate with or on behalf of this user?
- What current user opinions should shape recommendations and trade-offs?
- Which guidance is explicit, repeated, observed, or inferred?
- Which details require a linked note or evidence source?
- When does a current instruction or project decision override the durable default?

## User Outcome

A user can teach Agentic Memory how they want agents to communicate and decide without maintaining separate instruction files.

Future agents receive the guidance automatically through the existing startup sequence:

```text
MEMORY.md
→ USER.md, including Voice and Opinions
→ relevant project/map
→ detailed notes, records, or sources only when needed
```

## Domain Vocabulary

### Voice

A stable user preference governing how an agent communicates with the user or drafts material on the user’s behalf.

Voice may include:

- tone and posture;
- framing and emphasis;
- top-down or bottom-up information order;
- progressive-disclosure preferences;
- decision-presentation structure;
- preferred client-facing language;
- terminology to use or avoid;
- how confidence, evidence, and uncertainty should be expressed.

Voice does **not** include:

- one-off response-format instructions;
- project-specific content requirements;
- system or harness instructions;
- generic writing advice the user has not adopted;
- a complete style guide that exceeds `USER.md`’s budget.

### Communication preference

A stable preference about interaction mechanics between the user and agent, such as brevity, option formatting, question style, or progress reporting.

Communication preferences remain under `## Communication`. Voice belongs under `## Voice`.

Example distinction:

- Communication: “Use stack-ranked choices labeled A, B, C.”
- Voice: “Lead client communication with the recommendation, then descend through ranked discriminators and supporting evidence.”

### Opinion

A current, evidence-backed, revisable user preference or subjective judgment about how an agent should analyze choices, compare alternatives, or make recommendations.

Opinions may include preferences about:

- where an analysis should begin;
- how alternatives should be compared;
- how much complexity is useful;
- what strength of evidence justifies a recommendation;
- how uncertainty and conflicting evidence should affect the next decision;
- when adversarial review is worthwhile;
- how much rationale or auditability a consequential recommendation should preserve.

An opinion is a default for judgment, not a permanent conviction or mandatory rule. It may change when project outcomes, client feedback, stronger evidence, or direct user correction provide a better basis.

Opinions do **not** include:

- values or internal convictions;
- ideology or private worldview;
- objective facts;
- project-specific requirements or client positions;
- mandatory procedures;
- voice or presentation guidance;
- assistant-authored conclusions the user has not adopted.

### Project-specific decision

A requirement, gate, constraint, or choice that applies to one project or client. It belongs in the relevant project file or project-linked note unless the user explicitly generalizes it beyond that context.

Example:

- “NWM requires local-first processing” is a project-specific decision.
- “Prefer confirming requirement authority and applying confirmed gates before comparing differentiators” may be a durable opinion when explicitly stated or repeated across projects.

### Normative guidance

Voice or opinion guidance that an agent may apply as a revisable default. Only **Explicit** or **Repeated** entries are normative by default.

### Candidate guidance

An **Observed** or **Inferred** pattern that may become normative after confirmation or repetition. Candidate guidance belongs under `## Inferred preferences` or in a linked note until promoted.

## Canonical `USER.md` Body Contract

The recommended section order becomes:

```md
# User

## Profile

## Communication

## Voice

## Opinions

## Glossary

## Preferences and working patterns

## Inferred preferences

## Related notes
```

### Section responsibilities

| Section                            | Owns                                                                                        | Does not own                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Profile`                          | Stable owner facts and context                                                              | Communication or analytical preferences                           |
| `Communication`                    | Interaction mechanics and response-format preferences                                       | Client-facing authored style or analytical opinions               |
| `Voice`                            | Tone, framing, information order, evidence/uncertainty presentation, authored style         | One-off formatting, project-specific copy, or analytical judgment |
| `Opinions`                         | Evidence-backed, revisable preferences and judgments that shape analysis and recommendation | Values, facts, procedures, sensitive worldview, or project gates  |
| `Glossary`                         | User-specific meanings and canonical terms                                                  | Policies or preferences                                           |
| `Preferences and working patterns` | Durable workflow, tool, collaboration, and execution preferences not owned above            | Duplicated voice or opinions                                      |
| `Inferred preferences`             | Lower-confidence candidate guidance awaiting confirmation or repetition                     | Normative voice or opinions                                       |
| `Related notes`                    | Progressive-disclosure routes to detailed user-pattern notes                                | Full duplicated guidance                                          |

### Entry form

Entries use the existing confidence vocabulary:

```md
## Voice

- Explicit: Use top-down progressive disclosure in client communication: recommendation now, ranked discriminators, then supporting evidence.
- Repeated: State consequential unknowns and explain what evidence would resolve them.

## Opinions

- Explicit: Prefer starting simple and adding complexity only when it improves the decision.
- Repeated: Prefer recommendation confidence to match the evidence actually gathered.
```

When provenance or detailed rationale matters, append a compact wikilink:

```md
- Explicit: Prefer recommendation confidence to match the evidence; see [[notes/evidence-calibrated-recommendations]].
```

Do not place raw session paths, transcript excerpts, or long evidence blocks in `USER.md`.

## Confidence and Promotion Policy

### Voice

- **Explicit** — the user directly states the preference or explicitly confirms a proposed voice rule. May be stored under `## Voice`.
- **Repeated** — the preference appears consistently across projects or many sessions. May be stored under `## Voice` with concise wording.
- **Observed** — the pattern appears in a limited context. Keep it under `## Inferred preferences` or a linked note until confirmed or repeated.
- **Inferred** — the agent suspects the preference. Keep it under `## Inferred preferences`; never apply it as a firm authored-voice rule.

### Opinions

Opinions have a higher promotion threshold because they affect judgment:

- **Explicit** — the user directly states the opinion or explicitly adopts a proposed analytical preference. May be stored under `## Opinions`.
- **Repeated** — the same analytical preference or rationale appears across multiple projects or many sessions without contradiction. May be stored under `## Opinions`, preserving the `Repeated` label and linking evidence when attribution or rationale matters.
- **Observed** — do not promote directly to `## Opinions`; retain as a candidate in `## Inferred preferences`, project memory, or a linked note until confirmed or repeated.
- **Inferred** — do not promote to `## Opinions`.

An assistant-authored recommendation becomes an Explicit user opinion only when the user explicitly adopts it. Silence, continuation to the next task, generic approval of a deliverable, or package-level acceptance is insufficient when attribution is ambiguous.

When later evidence conflicts with an opinion, preserve its evidence trail, record a visible correction when the change is material, and revise the compact entry instead of treating it as permanent.

## Authority and Override Rules

Voice and opinions are durable defaults, not higher-priority instructions.

Apply authority in this order:

1. system, harness, safety, and repository instructions;
2. the user’s current explicit instruction;
3. current project/client decisions and confirmed constraints;
4. explicit or repeated `USER.md` opinions relevant to the decision;
5. explicit or repeated `USER.md` voice relevant to the communication;
6. observed or inferred candidate preferences, used cautiously and never as authority.

Rules:

- Current evidence wins over stale memory.
- Project facts, client positions, confirmed requirements, and hard gates constrain or override general opinions within their scope.
- A general opinion must not erase a narrower project decision or be presented as an objective fact.
- An opinion must not be converted into a mandatory procedure without separate authority.
- If current user direction conflicts with `USER.md`, follow the current direction and ask whether the durable memory should be updated when the change appears lasting.
- If two durable opinions conflict, surface the trade-off rather than silently selecting one.

## Progressive-Disclosure and Size Policy

This feature must not create a second always-loaded style guide inside `USER.md`.

Retain the existing `USER.md` budget:

- soft budget: 250–800 words;
- warning threshold: more than 1,200 words.

Guidelines:

- `## Voice` should normally contain no more than 8 compact rules.
- `## Opinions` should normally contain no more than 12 compact opinions.
- An entry should normally fit in one bullet.
- Detailed examples, decision procedures, evidence histories, exceptions, or domain-specific applications belong in one focused atomic note linked from the compact `USER.md` entry.
- Prefer one canonical entry over several paraphrases.
- Reflection should flag duplicate, conflicting, stale, unsupported, weakly attributed, overgeneralized, or excessively detailed entries, including values, facts, and procedures misclassified as opinions.

The numerical section limits are guardrails, not schema errors. The `USER.md` word warning remains the enforceable review signal.

## Capture Behavior

Memory Steward and ordinary agent closeout should evaluate durable voice and opinion signals explicitly.

### Positive voice signals

Examples:

- “Use this tone in future client communication.”
- “My voice is…”
- “Always lead with the recommendation.”
- “Use top-down progressive disclosure.”
- repeated corrections to the same framing or language across projects.

### Positive opinion signals

Examples:

- “In my opinion…”
- “I prefer evaluating options by…”
- “My current view is…”
- “Start simple and add complexity only when it improves the decision.”
- “For recommendations, I prefer…”
- explicit adoption of a proposed analytical preference;
- repeated analytical preferences or rationale across projects without contradiction.

### Negative signals

Do not promote:

- a one-off response-format request;
- a style requirement limited to one artifact;
- a client’s preference as the vault owner’s preference;
- a project-specific constraint or client position as a user opinion;
- a value or internal conviction recast as an analytical preference;
- a mandatory procedure recast as an opinion;
- voice or presentation guidance duplicated as an opinion;
- an assistant proposal the user did not explicitly adopt;
- an isolated observation that has not been confirmed or repeated;
- inferred sensitive traits or private worldview;
- a factual claim about the world merely because the user mentioned it;
- raw transcript text or hidden reasoning.

### Destination decision

Use:

- `USER.md#Voice` for compact stable authored-voice rules;
- `USER.md#Opinions` for compact evidence-backed, revisable analytical preferences;
- `USER.md#Inferred preferences` for lower-confidence candidates;
- `notes/` for detailed reusable patterns, rationale, examples, or decision procedures;
- `projects/` for project-specific constraints and observations;
- `sources/` for immutable evidence captures when provenance needs preservation;
- `records/` for dated decision, correction, or revision history.

Capture must deduplicate against current `USER.md` and linked notes before adding a new entry. When attribution or rationale matters, retain a compact evidence link that distinguishes direct statements, explicitly adopted proposals, repeated patterns, and observations.

## Sensitive Information Boundary

This feature is not a mechanism for profiling the user.

Agents must not infer or store sensitive opinions, traits, or private facts from behavior, language, associations, or project choices. In particular, do not derive political, religious, medical, identity, personality, or similarly sensitive conclusions and label them as opinions.

If a user explicitly requests storage of sensitive personal information, existing Agentic Memory privacy and human-authorship policy still applies; this feature adds no new permission or automatic capture path.

Opinions should be phrased as revisable analytical preferences, not psychological characterizations or objective facts.

Prefer:

> Explicit: Prefer recommendation confidence to match the evidence actually gathered.

Avoid:

> Inferred: The user is risk-averse.

## Consumer Behavior

After loading `USER.md`, an agent should:

1. apply relevant explicit/repeated voice rules when responding or drafting on the user’s behalf;
2. apply relevant explicit/repeated opinions when generating options, evaluating trade-offs, and recommending next actions;
3. load linked detail only when the current task needs it;
4. state conflicts or missing authority instead of inventing a resolution;
5. preserve project-specific decisions and current user direction;
6. avoid mentioning the memory mechanism in normal client-facing output unless asked.

Voice affects presentation. Opinions affect judgment. Facts constrain both, and procedures describe execution. Some entries may affect more than one concern, but the canonical wording should live in the section that owns the dominant behavior, with a link rather than duplicated text when detail is needed.

## Example `USER.md` Excerpt

This example is illustrative. The canonical clean vault template must keep the sections empty except for scaffold examples inside `.agentic-memory/templates/user.md`.

```md
## Communication

- Explicit: Prefer concise stack-ranked options for prioritization.

## Voice

- Explicit: Use top-down progressive disclosure in client communication: recommendation now, ranked discriminators, then supporting findings.
- Explicit: Use a discrimination framework that makes decisive differences visible rather than presenting feature catalogs.
- Explicit: Frame AI as practical augmentation that keeps people in control.

## Opinions

- Explicit: Prefer starting with the current workflow and one concrete project decision.
- Explicit: Prefer starting simple and adding complexity only when it improves the decision.
- Explicit: Prefer recommendation confidence to match the evidence actually gathered.
- Repeated: Prefer identifying the next justified decision instead of overstating finality.
```

## Separate-File Policy

The canonical vault must not require, route to, or scaffold:

```text
VOICE.md
OPINION.md
OPINIONS.md
```

Reasons:

- `USER.md` is already always loaded;
- separate files create another startup route and context decision;
- voice and opinions are owner memory, not control-plane instructions;
- splitting them makes confidence, authorship, and deduplication harder to maintain;
- detailed material already has an established progressive-disclosure destination in `notes/`.

This policy does not prohibit project-specific style guides or business-brand notes when they are genuinely project/domain artifacts. Those files must be routed through the relevant project or map and must not replace owner-level `USER.md` guidance.

## Repository Change Surface

Implementation should update the smallest coherent set of contracts.

### Canonical vault template

- `packages/vault-template/template/USER.md`
- `packages/vault-template/template/.agentic-memory/templates/user.md`
- `packages/vault-template/template/.agentic-memory/instructions/writing-memory.md`
- `packages/vault-template/template/.agentic-memory/instructions/session-capture.md`
- `packages/vault-template/template/.agentic-memory/instructions/reflection.md`
- `packages/vault-template/template/.agentic-memory/instructions/cross-project-persistence.md`
- both LLM contract files where their description of `USER.md` must mention voice and opinions

The root template `AGENTS.md` should continue routing through the LLM contract and `USER.md`; it must not name separate voice/opinion files.

### Human-facing documentation

- `README.md`
- `docs/architecture.md`
- `docs/schema.md`
- `docs/operating-model.md`
- `docs/linking-and-maps.md`
- `docs/cross-project-persistence.md`
- `docs/reflection-workflow.md`

### Tests

At minimum:

- strengthen `packages/vault-template/test/template-package.test.ts` to assert that canonical `USER.md` contains exactly one `## Voice` and one `## Opinions` section in canonical order;
- assert the bundled template does not contain root `VOICE.md`, `OPINION.md`, or `OPINIONS.md`;
- verify the user scaffold and root `USER.md` remain aligned;
- add deterministic fixtures or prompt-contract tests for capture destination rules if those instructions become executable code rather than LLM-only policy.

## No Core Retrieval Change Required

`USER.md` is already:

- required by the vault structure;
- always loaded by agent startup;
- parsed as managed `type: user` memory;
- included in semantic indexing;
- available to Memory Steward capture.

Therefore this feature does not require:

- a new managed-memory type;
- a new semantic-index table or column;
- a new Recall public response field;
- a new CLI command;
- a separate retrieval pass;
- a new startup file.

Core or CLI changes are justified only if implementation discovers a real contract gap in capture, storage, or application behavior.

## Acceptance Scenarios

### 1. Explicit voice preference

Given the user says, “Use top-down progressive disclosure for future client communication,” capture stores a compact `Explicit` rule under `USER.md#Voice`.

### 2. Explicit analytical opinion

Given the user says, “I prefer recommendations that match their confidence to the evidence and identify the next justified decision,” capture stores a compact `Explicit` entry under `USER.md#Opinions`.

### 3. One-off formatting request

Given the user asks, “Use a table for this answer,” capture does not create a durable Voice entry without additional evidence that the request is a lasting preference.

### 4. Project-specific requirement

Given a client project requires local-first processing, capture stores the gate in the project context. It does not promote that project requirement into `USER.md#Opinions`.

### 5. Unaccepted assistant proposal

Given an assistant proposes an analytical preference and the user continues without explicit adoption, capture does not store it as an Explicit opinion.

### 6. Repeated cross-project pattern

Given the same analytical preference or rationale appears across multiple projects without contradiction, Reflection may propose a `Repeated` Opinions entry or linked note. Material `USER.md` changes remain reviewable.

### 7. Value or internal conviction

Given the user states a personal value or internal conviction, capture does not automatically recast it as an analytical opinion. It stores nothing under `USER.md#Opinions` unless the user separately expresses a revisable preference about analysis or recommendation behavior.

### 8. Detailed style guide

Given voice guidance exceeds the `USER.md` budget, `USER.md#Voice` keeps compact rules and routes to a focused atomic note for examples and exceptions.

### 9. Conflicting current instruction

Given `USER.md#Voice` prefers concise answers but the current user asks for a detailed specification, the current instruction wins. The durable preference is not silently deleted.

### 10. Sensitive inference

Given session behavior could be interpreted as a political, religious, medical, identity, or personality opinion, capture does not store or infer that opinion.

## Deterministic Verification Requirements

Implementation is complete only when:

- the clean canonical `USER.md` contains `Voice` and `Opinions` sections;
- the control-plane user template uses the same section contract;
- documentation distinguishes Communication, Voice, Opinions, general Preferences, and Inferred preferences;
- capture and Reflection instructions enforce confidence and sensitive-information boundaries;
- no canonical startup path references separate voice/opinion files;
- template tests assert section presence/order and separate-file absence;
- `bun run check` passes;
- Git status and diff are summarized without committing automatically.

## Explicit Non-Goals

This feature does not:

- create a new `type: voice` or `type: opinion`;
- add nested frontmatter for voice or opinions;
- create a `voice/` or `opinions/` folder;
- require separate root voice/opinion files;
- add automated personality profiling;
- infer sensitive worldview or traits;
- turn `USER.md` into a full style guide or constitution;
- make durable opinions override current user direction or project facts;
- automatically convert every preference into an opinion;
- recast values, facts, project requirements, or procedures as opinions;
- change Recall’s public contract;
- add a new hosted model, inference service, or external dependency.

## Tracer-Bullet Implementation Slices

### Slice 1 — Canonical body contract

- update root and control-plane user templates;
- update schema and architecture documentation;
- add template assertions for section presence, order, and separate-file absence;
- preserve the existing `USER.md` word budget.

**Exit:** A newly initialized vault has one canonical empty `USER.md` scaffold containing Voice and Opinions and no separate voice/opinion files.

### Slice 2 — Authoring, capture, and Reflection policy

- update writing, cross-project, session-capture, and Reflection instructions;
- document confidence thresholds, destination rules, authority, sensitive boundaries, and deduplication;
- add deterministic tests for any executable policy introduced.

**Exit:** Agents have one consistent rule for capturing, applying, and reviewing voice and opinions.

### Slice 3 — Documentation and cross-contract alignment

- update README, operating model, linking, and Reflection documentation;
- verify terminology and section ownership across the template, control plane, and human-facing docs;
- confirm no startup path or scaffold introduces separate voice or opinion files.

**Exit:** All public and LLM-facing contracts describe the same canonical sections, boundaries, and capture behavior.

## Completion Criteria

The feature is complete when:

1. `USER.md` is the canonical and only required always-loaded owner-memory file for voice and opinions.
2. `## Voice` and `## Opinions` have distinct documented responsibilities.
3. Only explicit or repeated guidance becomes normative by default.
4. project-specific decisions remain project-specific unless the user independently states a cross-project analytical preference.
5. detailed material routes to notes rather than bloating `USER.md`.
6. no canonical template, control-plane contract, adapter, or document requires separate voice/opinion files.
7. values, facts, project requirements, and procedures are not recast as opinions.
8. sensitive opinion inference is explicitly prohibited.
9. startup, capture, Reflection, semantic indexing, and Recall retain their existing public architecture.
10. deterministic repository validation passes.

## Approved Decisions

The user approved:

1. **Section names:** exactly `## Voice` and `## Opinions`.
2. **Canonical order:** Profile → Communication → Voice → Opinions → Glossary → Preferences and working patterns → Inferred preferences → Related notes.
3. **Normative threshold:** Explicit and Repeated only; Observed and Inferred remain candidates.
4. **Budget stance:** retain the current `USER.md` soft budget and warning threshold.
5. **Evidence and revision:** preserve evidence-aware attribution and record visible corrections for material changes.
6. **Compatibility stance:** introduce no consolidation or compatibility work for separate voice or opinion files because they have never been part of the Agentic Memory contract.
7. **Visible terminology:** use “Voice” and “Opinions” consistently in user-facing Agentic Memory documentation.
