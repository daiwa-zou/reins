---
name: writing-a-contract
description: How to write a definition of done the evaluator can actually verify: concrete criteria, exact verification steps, one failure path, hard vs soft. Use in the contract stage.
---

# Writing a contract

A contract is a list of observable outcomes with a verification step each. The evaluator will run exactly these steps and nothing else, so vague criteria fail by default.

**Good criterion**
- text: `GET /health responds 200 with JSON containing status, uptime and sha`
- verify: `curl -s localhost:3000/health | jq 'has("status") and has("uptime") and has("sha")'`
- hard: true

**Bad criterion**
- `The endpoint works correctly` (not observable; no verification)
- `Code is clean` (subjective)

Rules of thumb
- 4-12 criteria. Fewer than 4 means the task is under-specified; more than 12 means you are listing implementation steps, not outcomes.
- Every `verify` is something that can run in this workspace: a command, a request, a file to inspect. Name the port, path or flag.
- Include at least one failure path (bad input, missing dependency, second run).
- Mark as **hard** the criteria without which the task is not done. Soft criteria are nice-to-haves that do not fail the sprint.
- Do not promise what you cannot check here (production behaviour, browser-only effects without a browser).
