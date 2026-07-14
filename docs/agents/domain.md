# Domain Docs

How engineering skills should consume this repository's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repository root.
- **`docs/adr/`** — read ADRs that touch the area you are about to work in.

This is a single-context repository. There is no `CONTEXT-MAP.md` and no context-scoped ADR directory under `app/src/`.

## File structure

```
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   └── agents/
└── app/
```

## Use the glossary's vocabulary

When an output names a product concept (in an issue title, refactor proposal, hypothesis, or test name), use the term as defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is not in the glossary, either reconsider the terminology or record it as a candidate for future domain modelling.

## Flag ADR conflicts

If an output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
