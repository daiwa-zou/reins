---
name: verify-like-a-user
description: How to check a feature the way a person would (run it, hit it, open it) instead of trusting unit tests or your own summary. Use before calling finish or report_evaluation.
---

# Verify like a user

Unit tests passing is necessary, not sufficient. Claude has marked features done after a green `curl` while the UI was broken. Before you declare anything done, do at least one of these from the outside:

1. **Run the real entry point** the way the README says to (`npm start`, `go run ./cmd/...`, `python -m ...`) with a timeout, in the background, then exercise it:
   - HTTP: `curl -s -i` the endpoint; check status and body shape with `jq`.
   - CLI: run it with representative arguments and with a bad argument.
   - Library: write a 5-line script that imports and calls it.
2. **Try the second call.** Many bugs show on the second request, second run, or after a restart (state, caching, ports).
3. **Try one failure path.** Empty input, wrong type, missing file, no network. The contract usually names one.
4. **Run it from a different directory** if the program resolves paths (`cd / && node /abs/path/...`).
5. **Quote the evidence.** The command and the relevant lines of output go into your summary or report. "Tests pass" is not evidence; the output is.

Clean up what you started (kill background servers, remove temp dirs) before you finish.
