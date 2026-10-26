---
title: Desktop Extensions: One-click MCP server installation for Claude Desktop
date: 2025-06-26
url: https://www.anthropic.com/engineering/desktop-extensions
tags: mcp, tools, infra, safety
takeaway: Desktop Extensions turn local MCP servers into single-file bundles with a declarative manifest, bundled runtimes and host-collected configuration, replacing manual config editing and dependency management. Sensitive settings live in the OS keychain, capabilities are declared up front, and enterprises get allow and block controls. Packaging integrations with a manifest is what makes them installable by non-technical users.
source: post
standing: bundled
foundations: declarativeConfig
---

## Learnings
- Problem: local MCP servers (filesystem, databases, local apps, private data) stayed inaccessible to non-technical users. Five friction points: developer tools required (Node.js/Python runtimes), manual JSON config edits per server, dependency management (version conflicts), no discovery mechanism (search GitHub), and update complexity (manual reinstall).
- Before: install Node, `npm install -g`, hand-edit `~/.claude/claude_desktop_config.json`, restart, hope. After: download the `.mcpb`, double-click, click Install. Update 2025-09-11: extensions now use `.mcpb` (MCP Bundle) instead of `.dxt`, and old files still work.
- Format: a `.mcpb` file is a ZIP archive containing the MCP server, all dependencies, and `manifest.json` (the only required file). Layouts cover Node (`server/index.js`, `node_modules/`, optional `package.json`, `icon.png`), Python (`server/main.py`, `server/utils.py`, `lib/` bundled packages, optional `requirements.txt`), and binary executables. Claude Desktop ships a built-in Node.js runtime, performs automatic updates, and stores secrets (API keys) in the OS keychain.
- Manifest minimum: `mcpb_version` ("0.1"), `name`, `version` (semver), `description`, `author.name`, and `server {type: node|python|binary, entry_point, mcp_config {command, args}}`. `${__dirname}` resolves to the unpacked extension directory.
- `user_config` declares inputs the host collects before enabling. Example `api_key`: type string, `sensitive: true`, `required: true`, so Claude will not enable the extension until supplied; the value is stored in the OS secret vault and `${user_config.api_key}` is substituted at launch into `env` (e.g. `API_KEY`).
- `user_config` field types: `directory` (with `multiple`, `required`, `default` such as `${HOME}/Desktop`), `string` (`sensitive`, `required`), and `number` (`default`, `min`, `max`, e.g. max file size default 10, range 1-100). The host shows a configuration UI, validates inputs before enabling, stores sensitive values securely, and passes config as args or env (example `ALLOWED_DIRECTORIES`).
- Optional manifest fields: `display_name`, `long_description` (markdown), `repository`, `homepage`, `documentation`, `support`, `icon`, `screenshots`; author `email` and `url`; features `tools` (name, description), `prompts` (name, description, arguments, text, e.g. a "poetry" prompt with `${arguments.topic}`), and `tools_generated` boolean; discovery `keywords` and `license`; and `compatibility {claude_desktop: ">=1.0.0", platforms: [darwin, win32, linux], runtimes: {node: ">=16.0.0"}}`. Declared `tools` and `prompts` tell users up front what the extension can do.
- Cross-platform and templating: a `platforms` object inside `mcp_config` overrides per OS (win32: command `node.exe`, env `TEMP_DIR=${TEMP}`; darwin: `TEMP_DIR=${TMPDIR}`). Template variables are `${__dirname}`, `${user_config.key}`, `${HOME}`, `${TEMP}`, and `${arguments.*}` in prompts.
- Toolchain: `npx @anthropic-ai/mcpb init` (interactive; `--yes` for minimal) generates the manifest and `npx @anthropic-ai/mcpb pack` validates and builds the archive. To test, drag the `.mcpb` into Claude Desktop Settings, which shows human-readable info, required permissions and configuration, and Install.
- Directory: a curated directory built into Claude Desktop lets users browse, search and one-click install without vetting GitHub code. Submission means following guidelines, testing on Windows and macOS, submitting the form, and Anthropic reviewing for quality and security.
- Open ecosystem: the full MCPB spec, packaging and validation tools, reference implementation, and the TypeScript types and schemas used by Claude for macOS/Windows are open-sourced. The goal is for other desktop AI apps to adopt the format so server developers package once and run anywhere; it is versioned 0.1 deliberately, with community input invited.
- Security and enterprise: users get secrets in the OS keychain, automatic updates, and the ability to audit installed extensions. Enterprises get Group Policy (Windows) and MDM (macOS) support, pre-installed approved extensions, blocklists for specific extensions or publishers, the option to disable the directory entirely, and private extension directories.
- Building with Claude Code: describe the extension briefly, then add a standard context block instructing Claude to read the MCPB README, MANIFEST.md, and examples (including Hello World), create a valid manifest, and implement the server with `@modelcontextprotocol/sdk` with proper tool definitions, error handling, and timeout management.
- The recommended server shape is stdio transport, clear schemas and validation, consistent JSON responses, local execution, logging and debugging, and setup docs, then testing that tool calls return well-structured responses and the manifest loads. An internal example was the PyBoy GameBoy emulator packaged as an extension.

## Harness implications
- [component:skills] Package an integration as a single bundle whose only hard requirement is a declarative manifest.
  > `manifest.json` (the only required file)
- [foundation:declarativeConfig] Collect configuration declaratively with types, required flags, defaults and ranges, render the form from it, and refuse to enable until required values exist.
  > The host shows a configuration UI, validates inputs before enabling
- [foundation:secretsOutside] Store secrets outside the agent and inject them through env or args, never into the model's context.
  > the value is stored in the OS secret vault
- [foundation:declarativeConfig] Declare an integration's tools and permissions in its manifest so the UI can show them before it is enabled.
  > Declared `tools` and `prompts` tell users up front what the extension can do.
- [gap] Provide init, pack and validate tooling and an install screen with readable metadata and permissions.
  > `npx @anthropic-ai/mcpb pack` validates and builds the archive
- [gap] Support allow and block lists by integration or publisher, private directories and an installed-integration audit view.
  > blocklists for specific extensions or publishers
- [foundation:declarativeConfig] Handle platform differences with per-OS overrides in the manifest rather than code the user must edit.
  > a `platforms` object inside `mcp_config` overrides per OS
- [foundation:declarativeConfig] Publish the config format as an open, versioned spec at 0.x while gathering feedback.
  > it is versioned 0.1 deliberately, with community input invited
