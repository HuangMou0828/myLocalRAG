# Wiki Promotion Pipeline

This document defines how myLocalRAG should promote existing `vault/sources/*.md` evidence pages into the reader-first knowledge layer:

- `vault/projects/`
- `vault/patterns/`
- `vault/issues/`
- `vault/syntheses/`

The concrete page schema and merge contract for these note families lives in [wiki-page-contract.md](./wiki-page-contract.md).

The design is tailored to the current data shape:

- A large portion of the corpus is LLM conversation history.
- Many sessions are coding-heavy and contain noisy code blocks.
- User prompts are colloquial and often omit context.
- Assistant responses vary heavily across providers.
- Other imported fragments are usually cleaner and more self-contained.

## 1. Mental Model

Treat the vault as two layers:

1. Evidence layer: `sources/`
   - Source sessions and imported fragments.
   - May be rough, provider-specific, and only lightly normalized.
   - Primary purpose: traceability and AI retrieval.

2. Reader-first layer: `projects/`, `patterns/`, `issues/`, `syntheses/`
   - Short, stable, cross-source, and pleasant to read in Obsidian.
   - Primary purpose: human navigation and durable knowledge.

Promotion is the act of turning evidence into durable notes.

In the current MVP, promotion is intentionally split into two steps:

1. Generate candidate work in `vault/inbox/promotion-queue.md`
2. Review or promote the candidates into durable reader-first notes

This keeps the wiki from growing uncontrollably while still letting query/publish workflows surface new candidate knowledge.

## 2. Source Reality And Constraints

### 2.1 LLM conversation sources

Typical problems:

- User prompts omit project or file context that was obvious during the original chat.
- Assistant replies may include too much scaffolding language, e.g. "I will now fix this".
- Large code blocks often dominate token count while adding little reading value.
- Multiple providers may answer the same problem with different tone and granularity.
- A single conversation can mix architecture, bug fixing, implementation, and product discussion.

Implication:

- A source session should never be promoted wholesale into a reader-first page.
- We must first extract smaller evidence atoms.

### 2.2 Cleaner fragment sources

Typical properties:

- Short pasted notes, article excerpts, snippets, docs, or structured fragments.
- More complete context.
- Lower cleanup cost.

Implication:

- These can promote directly into `concepts/` or `syntheses/`.
- They still need evidence linking, but they require less de-noising.

## 3. Promotion Targets

Promotion should only create or update four page families.

### 3.1 `project-hub`

Use when evidence points to the same repo, app, or ongoing workstream.

A project page answers:

- What is this thing?
- What are the important modules?
- Which patterns keep repeating here?
- Which issues have occurred here?

### 3.2 `pattern-note`

Use for reusable solutions, not one-off event history.

A pattern page answers:

- When should I use this?
- What shape does the solution usually take?
- What tradeoffs should I expect?

### 3.3 `issue-note`

Use for failures, debugging situations, and symptom-to-fix mappings.

An issue page answers:

- What breaks?
- Why does it usually break?
- What fix path tends to work?
- How do I validate the fix?

### 3.4 `synthesis-note`

Use for higher-level conclusions, comparisons, plans, or question-driven memos.

A synthesis page answers:

- What is the conclusion?
- Why is that conclusion reasonable?
- What evidence supports it?
- What remains uncertain?

## 4. Evidence Atom Extraction

Promotion should not work directly from raw transcript paragraphs. It should first extract evidence atoms from each source page.

Each source session should be normalized into a list of atoms like:

```json
{
  "kind": "issue|pattern|decision|context|artifact|question",
  "project": "myLocalRAG",
  "provider": "codex",
  "title_hint": "Embedding fallback always local",
  "symptom": "remote embedding always falls back to local",
  "cause": "env was loaded after config was frozen",
  "fix": "read embedding env at call time instead of module load time",
  "validation": "retrieve returns embedding.source=remote",
  "files": ["server/lib/embedding.mjs", "server/index.mjs"],
  "topics": ["embedding", "rag"],
  "confidence": 0.84,
  "evidence_refs": ["sources/codex__..."]
}
```

### 4.1 Required extraction fields

Extract the following whenever possible:

- `project`
- `files`
- `frameworks_or_tools`
- `error_or_symptom`
- `root_cause`
- `fix_shape`
- `validation_signal`
- `decision_or_tradeoff`
- `topics`
- `evidence_span`

### 4.2 Conversation cleanup rules

Before extracting atoms from LLM chats:

- Drop provider tone such as "I will now", "you are right", "if you want I can".
- Collapse repeated assistant confirmations into one action statement.
- Keep code blocks only if they are:
  - the actual fix shape,
  - the only usable evidence,
  - or a compact reusable pattern.
- Prefer extracting file references and decisions over preserving transcript order.
- Reconstruct missing context from title, file mentions, and nearby messages.

## 5. Promotion Heuristics

Promotion should be score-based, not binary-only.

## 5.1 Promote to `issue-note`

Create or update an issue when the source contains:

- a clear symptom or error, and
- either a likely cause, a fix, or a validation step.

Strong cues:

- error words such as `error`, `failed`, `undefined`, `timeout`, `fallback`
- user reports that something "doesn't work", "没反应", "搜不到", "一直是 local"
- assistant provides a cause/fix pair
- a validation step is present

Suggested confidence scoring:

- `+0.35` symptom/error extracted
- `+0.20` cause extracted
- `+0.20` fix extracted
- `+0.10` validation extracted
- `+0.10` file references exist
- `+0.05` repeated across multiple sources

Promotion threshold:

- Create new issue page at `>= 0.55`
- Merge into existing issue page when title/symptom cluster similarity is high

## 5.2 Promote to `pattern-note`

Create or update a pattern when the source contains:

- a reusable fix shape, design shape, or workflow, and
- the advice is not tied to one single incident only.

Strong cues:

- repeated "do X, then Y, then Z" guidance
- multiple sessions solving similar problems with similar structure
- file-level architecture choices, loading patterns, state orchestration patterns
- phrases like "推荐做法", "建议流程", "通常这样做", "fix pattern"

Suggested confidence scoring:

- `+0.30` a reusable multi-step shape exists
- `+0.20` tradeoff or rationale exists
- `+0.20` appears in at least 2 sources
- `+0.15` linked to concrete files or modules
- `+0.10` can be described without provider-specific language
- `+0.05` validated in repo context

Promotion threshold:

- Create new pattern page at `>= 0.60`

## 5.3 Promote to `project-hub`

Project hubs should not be created from one session alone unless the project is already known.

Create or update a project page when:

- the source names a repo/project repeatedly, or
- file paths clearly belong to one repo, or
- multiple related patterns/issues point back to the same workstream.

Project updates should aggregate:

- important files
- active patterns
- active issues
- current focus

Promotion threshold:

- Update project if project name confidence is `>= 0.50`
- Create project only if at least 2 sources or 1 source plus explicit repo path exists

## 5.4 Promote to `synthesis-note`

Use synthesis only when the source is question-driven and the answer itself is durable.

Good triggers:

- architecture comparisons
- roadmap or planning conclusions
- "what should we do next"
- conceptual frameworks
- cross-source analysis

Avoid synthesis when:

- the source is just an implementation fix
- the page would mostly duplicate an issue or pattern note

Promotion threshold:

- Create synthesis page at `>= 0.65`
- Prefer explicit user question as page seed

## 6. Clustering And Merge Rules

Promotion should cluster multiple evidence atoms before writing pages.

### 6.1 Issue clustering

Cluster by:

- normalized symptom text
- error keywords
- overlapping file references
- shared fix shape

Example:

- "remote embedding always local"
- "embedding fallback always local"
- "source/model remains empty and fallback to local"

These should likely merge into one issue cluster.

### 6.2 Pattern clustering

Cluster by:

- same multi-step procedure
- same architectural shape
- same module family

Example:

- async panel loading
- domain stub + runtime domain handoff
- shell-only orchestration and delayed feature init

These should likely become one pattern note, not three.

### 6.3 Project clustering

Cluster by:

- repo root
- repeated explicit project names
- stable module namespace

Example:

- `/Users/hm/myLocalRAG/...`
- `myLocalRAG`
- `server/index.mjs`, `server/lib/wiki-vault.mjs`

All should feed the same project hub.

## 7. Writing Rules For Promoted Pages

Once a cluster is stable enough, write the reader-first page with these rules:

- First screenful must contain the answer.
- Do not preserve provider voice.
- Do not preserve transcript chronology unless it adds meaning.
- Code is appendix-quality, not headline-quality.
- Keep `## Evidence` as the final or near-final section.
- Use links only when they help navigation.

### 7.1 Reader-first page budget

Target lengths:

- `project-hub`: 1 to 2 screens
- `pattern-note`: 1 to 1.5 screens
- `issue-note`: 1 screen if possible
- `synthesis-note`: 1 to 2 screens

### 7.2 Evidence density

A promoted page should normally cite:

- at least 2 source pages for `pattern-note`
- at least 1 source page for `issue-note`
- at least 2 source pages or 1 strong question-driven source for `synthesis-note`

## 8. Human Readability Rules Specific To Coding Chats

For this corpus, human readability improves when:

- file paths are kept,
- errors are kept,
- validation steps are kept,
- giant code blocks are removed,
- fix logic is restated as a short pattern,
- provider-specific chatter is deleted.

This means coding chats should usually promote like this:

- raw session -> `source-conversation`
- repeated fix -> `issue-note`
- repeated architecture shape -> `pattern-note`
- repo-wide navigation page -> `project-hub`
- question-driven analysis -> `synthesis-note`

## 9. Query-Time Filing Rules

Queries should be able to create durable notes when the result is stable enough.

### 9.1 File into `synthesis-note`

If a query:

- compares options,
- proposes a roadmap,
- or produces a cross-source conclusion,

then the default filing target is `syntheses/`.

### 9.2 Update an existing `pattern-note`

If a query:

- adds a better explanation for an existing pattern,
- clarifies tradeoffs,
- or introduces another concrete example,

then update the pattern instead of creating a new synthesis.

### 9.3 Update an existing `issue-note`

If a query:

- adds a stronger cause,
- confirms validation,
- or discovers a new failure variant,

then update the existing issue page.

## 10. Recommended Pipeline Stages

Implement the promotion pipeline in this order:

1. `source normalization`
   - Turn current source sessions into normalized evidence atoms.
2. `project inference`
   - Infer repo/project labels from file paths, titles, and repeated names.
3. `issue extraction`
   - Highest leverage for coding-heavy chats.
4. `pattern extraction`
   - Promote recurring implementation and workflow shapes.
5. `project hub aggregation`
   - Link issues and patterns by project.
6. `query filing`
   - Allow stable answers to create/update synthesis pages.
7. `lint`
   - Merge duplicates and flag weak pages.

## 11. Practical Starting Point For This Repo

Given the current vault, the best first implementation step is:

- keep `sources/*.md` publishing as-is,
- add a normalized extraction pass over each source session,
- create clusters for:
  - embedding issues
  - retrieval issues
  - session/workspace UI patterns
  - bug trace patterns
  - wiki-vault patterns
- write one project hub for `myLocalRAG`,
- then only create promoted pages when confidence clears threshold.

Avoid bulk-generating hundreds of pages on day one.

It is better to have:

- 1 strong project page,
- 8 good patterns,
- 8 good issues,
- 3 strong syntheses,

than 80 thin notes nobody wants to read.
