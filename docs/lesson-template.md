---
title: Short title of the post or note
date: 2026-01-01
url: https://example.com/the-original-post
source: post
standing: unreviewed
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
- One dense bullet per learning. Keep the post's own numbers and examples, because implication quotes are checked against this text.
- Copy this file to $REINS_HOME/lessons/<slug>.md (the file name is the slug), then run npm run lessons:check.

## Harness implications
- [component:evaluator] One sentence: what this lesson claims about a harness component.
  > Keep the post's own numbers and examples
- [stage:build] One sentence a builder should read at the start of the build stage.
  domains: cli
  > One dense bullet per learning.
- [skill:verify-like-a-user] One sentence linking the lesson to a skill.
  > then run npm run lessons:check
- [foundation:eventLog] One sentence about a fixed architectural decision.
  > Copy this file to $REINS_HOME/lessons/<slug>.md
- [gap] An idea the harness does not implement yet; it shows on the Ideas list.
  > Keep the post's own numbers and examples
