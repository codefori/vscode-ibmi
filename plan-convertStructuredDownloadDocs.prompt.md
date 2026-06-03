# Plan: Convert Structured Download Documentation to .mdx Format for codefori/docs

**TL;DR**: Convert `/Users/cozzi/Downloads/projects/vscode-ibmi-fork/docs/structured-download.md` from Markdown to MDX format, following the Astro Starlight conventions used in the codefori/docs repository's tips section. This will allow the PR maintainer to accept the documentation update.

## Context

- PR #3144 is located in `/Users/cozzi/Downloads/projects/vscode-ibmi-fork`
- The maintainer accepted the feature but requested documentation be updated to match the `.mdx` style used in https://github.com/codefori/docs/tree/main/src/content/docs/tips
- Current docs are in standard Markdown (`.md`)
- Target format is MDX with Astro Starlight components

## Steps

1. **Examine existing structured-download.md** — Review full content to identify sections that could benefit from Starlight components

2. **Create the .mdx version** — Convert the file with these changes:
   - Add YAML frontmatter with `title: "Structured Download"`
   - Add import statement for Starlight components (likely `Aside`, `Card`, `CardGrid`, `Icon`)
   - Preserve all existing content structure (headings, lists, code blocks, tables, workflow diagram)
   - Consider enhancing key sections with components:
     - Use `<CardGrid>` and `<Card>` for side-by-side comparisons if appropriate
     - Use `<Aside>` for important notes (collision handling, recommendations)
   - Keep file extension as `.mdx`

3. **Determine target location** — The file should go in the codefori/docs repository under `src/content/docs/tips/` (not in vscode-ibmi repo's docs folder)

4. **Prepare for contribution** — User will need to:
   - Fork/clone the codefori/docs repository
   - Add the new `structured-download.mdx` file to `src/content/docs/tips/`
   - Test locally if possible (requires running the Astro site)
   - Create a PR to codefori/docs linking it to vscode-ibmi PR #3144

## Relevant Files

- `/Users/cozzi/Downloads/projects/vscode-ibmi-fork/docs/structured-download.md` — source documentation to convert

## Verification

1. Confirm YAML frontmatter is valid with `title` field
2. Verify import statements match patterns from existing tips files (e.g., `import { Aside, Card, CardGrid } from '@astrojs/starlight/components';`)
3. Check that all markdown syntax is preserved (headings, lists, code blocks, tables)
4. Ensure file would fit stylistically with other files in codefori/docs/src/content/docs/tips/
5. Validate the converted content preserves all original information

## Decisions

- **Location**: Documentation goes in codefori/docs repo, not vscode-ibmi repo
- **Components to use**: Start minimal — add frontmatter and import statements, but keep content mostly as-is unless specific sections clearly benefit from Card/CardGrid layout
- **Filename**: `structured-download.mdx` (matches original, just change extension)

## Further Considerations

1. **Should we use CardGrid/Card for the layout examples?** The current code blocks showing folder structures could remain as-is, or be wrapped in Cards for visual separation. Recommend keeping simple unless user prefers the card style.

2. **Should we add an Aside for the collision handling section?** The collision handling is important enough that an `<Aside type="caution">` or `<Aside type="tip">` might be appropriate.

3. **Navigation/sidebar ordering** — The codefori/docs repo may have a sidebar configuration. Should we check if there's a preferred ordering or grouping for tips files?
