---
title: Short title of the post or note
date: 2026-01-01
url: https://example.com/the-original-post
tags: context, tools
components: thinkTool
foundations: eventLog
domains: web
enables: evaluator
disables: narration
guidance: Start the dev server with a timeout and curl the routes you changed.
takeaway: One paragraph a reader can skim on a card. Say what the lesson is and why it matters to an agent harness.
---

## Learnings
- One dense bullet per learning. Keep the post's own numbers and examples.
- Copy this file to $REINS_HOME/lessons/<slug>.md (the file name is the slug), then run npm run lessons:check.

## Harness implications
- What this means for the harness: a component to add, keep, change or remove.
- components: and foundations: are optional comma-separated ids from docs/configuring.md; delete the lines you do not need.
- domains:, enables:, disables: and guidance: are optional preset effects: the lesson shapes the presets generated for those domains (web is Web app, cli is CLI / tool; any other lowercase id makes its own preset). enables/disables are component ids, guidance is one line of at most 200 characters added to every role's instructions. An unknown id, an id in both lists or a bad domain is an error; effects without domains are a warning.
