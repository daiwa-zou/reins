# Desktop Extensions: One-click MCP server installation for Claude Desktop
Source: https://www.anthropic.com/engineering/desktop-extensions
Lesson file checked against the original: no (self-audit by the author session against the distilled lesson file; the independent re-fetch pass was rate-limited and is queued)

| Learning or implication | Where in Reins | Status |
|---|---|---|
| Declarative manifest as the single hard requirement for an integration | Skills are folders with a SKILL.md frontmatter (`server/src/skills.ts:19`); no tool-server packaging | partial |
| Declarative config with types, required/sensitive flags and a generated settings UI | One typed RunConfig (`shared/types.ts`) drives the form, the server and the record (`web/src/panels/NewRun.tsx`); secrets via Settings, stored owner-only | implemented |
| Declare capabilities and permissions before install | Tools carry readOnly/deferred flags (`registry.ts` ToolDef) and components state their assumption (`shared/components.ts:11`); skills show source | partial |
| init/pack/validate tooling and a drag-to-install flow | Not implemented | gap |
| Enterprise allow/block lists and an installed-extension audit view | Guardrail allow/ask/deny patterns per run (`policy.ts:48`); no installed-integration view | partial |
| Platform differences handled in the manifest | Sandbox availability is detected at runtime (`sandbox.ts` sandboxAvailable) and shown in `/api/info` | partial |
| Open, versioned spec | Harness version constant (`shared/components.ts:3`), no published spec | partial |

## Gaps
- List installed skills (name, source, description, files) in the Harness tab with an enable switch per run.
- Once MCP servers are configurable, validate their manifests and show tools and required config before the first run.
