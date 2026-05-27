Open Questions after reading `docs/`:

- [ ] How can I tell what version of Agentic Memory I'm using to then know what migrations I need to apply?
- [ ] How are you going to add coding specific rules into the `AGENT.md` for this repo?
- [ ] Should the validation tool be a script or CLI? Should it be built/bundled with the agentic memory CLI?
- [ ] Should the Agentic Memory system even keep outputs locally? What are the tradeoffs?
- [ ] Should the memory system instructions live in a separate location from the memory files themselves?
- [ ] Can MOCs reference other MOCs? If so, how many layers deep can they reference?
- [ ] Why "graph leaves" used in the docs? Is it necessary?
- [ ] Is a MOC documented so any agent using it can understand what it does and how to use it?
  - [ ] Same for atomic notes?
- [ ] Where are common terms defined? Should there be a glossary or reference page?
- [ ] Shouldn't the `type: 'agent'` notes be stored in a separate location than the other memory files?
- [ ] Why do the `docs/` need frontmatter if they are for human readers?
- [ ] Why does the [[operating-model#Writing rules]] include `instructions/`?
- [ ] For uncertenty in the notes, should there be an inline tag (`#uncertain`, `#TODO-CONFIRM`) or comment (`<!-- UNCERTAIN -->`) indicating uncertainty?
- [ ] Should commiting to Git be a separate step the agent automatically performs after memory updates? Or should it be part of the memory reflection loop? See [[operating-model#Git workflow]]
- [ ] Is there any value in keeping the "Idea Compass" or "Idea Compass-style" reference in the `docs/`? I used it to help the agent understand the context of the idea but it may not be necessary in the docs.
  - [ ] Same with the Zettel references. Do they add specificity or are they just for human readers?
- [ ] What are the other maturity signals for note quality that can be added to [[linking-and-mocs#Maturity and connectivity]]?
- Sources
  - [ ] Why do sources need the `generated_by` field? What are the possible values? What value should it have if it was triggered by a human and contain changes that required human approval?
  - [ ] Should sources change to references and contain the full URL to non-local sources?
- Should there be an `agentic-memory` CLI tool or agent skill that will initialize a new memory repository?

Open Questions after reading `skills/reflection/SKILL.md`:

- Should the `skills/reflection/SKILL.md` reference standards, best practices, or guidelines that are separate instruction files instead of repeating them in the skill documentation? Would that be a good policy if we want a single source of truth for memory creation and reflection?

Open Questions after reading `templates/vault/`:

- [ ] Why does the `MEMORY.md` file have a header and "This file is the always-loaded..." sentance? Are they even necessary or is this just extra noise and token overhead?
- [ ] Why do the instructions need frontmatter?
- [ ] Right now the `README.md` file is just a routing table. Why isn't the `operating-model` information combined with the `README.md` file?
  - [ ] If `operating-model` and the `README.md` file are combined, should it be called `RULES.md`?
