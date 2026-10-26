---
title: Redesigning source control at Anthropic
date: 2026-10-13
url: https://www.anthropic.com/engineering/redesigning-source-control
tags: source-control, infra, coding-agents, multi-agent
takeaway: Git's decentralized, offline-first design broke when tens of thousands of merges a day came from always-online agents and jobs. The replacement, Scion, makes the server do the work, with server-side lock-free changesets, content-addressed immutable data, tiered caches and optional sparse working copies. For harness builders: assume agents are always-online API clients, make writes cheap, and move human review to intent-level.
source: post
standing: bundled
components: gitCommits
foundations: reviewIntent
---

## Learnings
- Scale that broke git: about 2,500 merges per day into the monorepo in May 2026, over 30,000 per day by September. Main branch history reached nearly 100 GB and the compressed working copy over 25 GB, with about 25 million CI checkouts per day before counting dev environments, agent sandboxes and research jobs. Naive fetching would be over 600 PB per day of git traffic.
- Workarounds tried: shallow clones, sparse checkouts, partial clones and promisor remotes (each solved part); several hundred internal git mirrors at peak (harder to operate as the merge rate rose, and they stopped scaling when the repo outgrew disk and memory); and repository "seeds" in blob storage (which drifted from the tip of main between refreshes, with diff and blame on partial clones needing increasing care).
- Root cause: git is decentralized (every clone a full repo) and designed for offline work, but Anthropic used it as a centralized system whose clients are almost all always-online agents and jobs. The properties that make git good offline undermined scaling.
- Principle 1: clients are always online and fetch on demand from a reachable server. Principle 2, client-server asymmetry: the server answers history, blame, commit, merge, and rebase, while the client keeps a bounded cache, lays out files, watches the filesystem and provides ergonomics, computing little and needing little data.
- Principle 3: a comprehensive service enables new applications, with everything via API so many jobs need no local repo; automated bisect and revert pipelines depend on this. Principle 4: everything is horizontally scalable, with no full copy of the repo anywhere (even on the server) and no packfiles, so no repo maintenance.
- Principle 5: commits are cheap, incremental, and lock-free, with commits, rebases and merges happening server-side so there is nothing to push. Cost scales with change size not repo size, and refs are discouraged except main and release branches (global state is a scaling problem). Principle 6: the working copy is optional and sparse, as many CI diffs and writes run via API with no checkout and sparse or virtualized checkouts materialize only what is read.
- Data structures: the unit of work is a changeset, an entry in a write-ahead log listing files changed relative to the first parent with content-addressed pointers to compressed blobs (not a tree pointer like a git commit). It is created server-side and available everywhere immediately, and a ref move is a compare-and-swap on a single Spanner row, separate from changeset creation.
- Derived data (blame, path history, commit-graph skip lists, copy detection, path search) is built recursively from parents through one generic mechanism; each type can be eager or deferred, and internals can change without client changes.
- Scaling: servers are essentially large caches that compute derived data and write back to Spanner, and all data is content-addressed and immutable so any server can cache without coordination. In the fetch protocol the client does not tell the server what it already has; it starts from a root tree, requests missing trees recursively, then blobs, with small, cacheable, resumable responses and no multi-GB packfile.
- Three tiers answer the same RPCs: a per-node `scion-daemon` (starts from a periodically refreshed snapshot), a regional `scion-cache` (in-memory, daemon disk format), and the authoritative `scion-server` (Spanner and cloud storage). Strict tiering isolates failure domains so a regional cache failure cannot overwhelm upstream, and each tier keeps a hit rate above 99% and holds no long-lived state.
- Results: infrastructure footprint about 200x smaller than the git mirror setup in CPU and memory, CI and research checkouts dropping from minutes to seconds, CI alone gaining 25% CPU capacity, and no repo maintenance for clients or caches.
- Team and velocity: seven people built Scion, Antique (code review), and about half a dozen related systems, and fully migrated in five months while merge volume grew 10x.
- Engineers' roles shifted: they judged Claude better at writing code than themselves but supplied system-level understanding and tradeoffs, and often their job was to say "no" to agent-proposed patterns that violated core constraints (e.g. Claude scanning the commit log linearly to find when a change merged instead of asking the review tool). Reviewers now focus on the intent of a change, not every line, and adversarial review can over-engineer (one review pushed Claude to add excessive validation against a trusted internal service).
- Claude performance wins: an early Claude Mythos Preview snapshot rewrote the hand-built git-to-Scion ingestion pipeline with 20x less memory and 4x faster while preserving ordering invariants, and Claude found an ancestry-query optimization that had missed an index (days or weeks of expert work).
- Testing and security: hermetic simulations of infrastructure interactions, fuzzing, rate limiting, repo-level access control and per-directory permissions. Antique supports semantic approval rules (e.g. comment-only changes separated from logic changes so humans focus on the latter).
- Operations with "superfan" Claudes: via Claude Tag, one Claude per component (scion-daemon, scion-cache, Antique merge queue) sits in a dedicated Slack channel with telemetry and log access, watching charts for anomalies and catching subtle issues threshold alerts miss. Traditional alerts still run alongside.
- Rethinking human-scale workflows: a merge queue with a global lock makes no sense when hundreds of changes land during one test run. Anthropic invested in post-merge and pre-deploy testing, accepting that concurrent changes can conflict, since Claude typically fixes conflicts faster than humans can detect them.
- Prior art credited: Google's Piper and Meta's Sapling (its server Mononoke and the Bonsai data model pioneered many techniques). Scion is not a general git replacement and will not be released; Anthropic hopes git adopts server-side RPCs, better-composing sparse and shallow features, and a different negotiation protocol, working with GitHub, GitLab, and the community.

## Harness implications
- [gap] Treat agents as always-online clients that fetch code, history and blame through a service, making full working copies optional.
  > clients are always online and fetch on demand from a reachable server
- [component:gitCommits] Keep commits cheap and avoid creating long-lived refs and branches as global state.
  > refs are discouraged except main and release branches (global state is a scaling problem)
- [gap] Offer automated bisect and revert pipelines the agent can trigger as tools.
  > automated bisect and revert pipelines depend on this
- [foundation:reliability] Prefer post-merge and pre-deploy testing over a serialized merge queue, and show post-merge health.
  > invested in post-merge and pre-deploy testing
- [foundation:reviewIntent] Give reviewers intent-level aids, such as summaries of what a change is for and rules separating trivial from consequential changes.
  > Reviewers now focus on the intent of a change, not every line
- [stage:plan] Write the architectural constraints the builder must not violate into the spec as explicit, checkable rules.
  > often their job was to say "no" to agent-proposed patterns that violated core constraints
- [stage:evaluate] Weigh each finding against the trust boundary, and do not demand extra hardening or validation where the input is already trusted.
  > adversarial review can over-engineer
- [gap] Run per-component monitoring agents with telemetry access alongside traditional alerts.
  > one Claude per component
- [component:osSandbox] Bound an agent's blast radius by path with per-directory permissions.
  > repo-level access control and per-directory permissions
- [foundation:eventLog] Store run artifacts as content-addressed, immutable data so caches need no coordination.
  > all data is content-addressed and immutable so any server can cache without coordination
