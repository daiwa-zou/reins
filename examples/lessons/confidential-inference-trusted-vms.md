---
title: Confidential Inference via Trusted Virtual Machines
date: 2025-06-18
url: https://www.anthropic.com/engineering/confidential-inference-trusted-vms
tags: safety, infra, sandboxing
takeaway: Confidential inference shrinks the trusted computing base to a small, signed, hypervisor-isolated loader that alone decrypts data and weights, while the rest of the inference stack is treated as untrusted and free to change. A keyserver releases keys only after hardware attestation. The same design applies to harnesses: a minimal reviewed trusted core guarantees safety no matter what the rest of the system does.
source: post
standing: bundled
components: osSandbox
foundations: secretsOutside
---

## Learnings
- "Confidential Inference" means processing encrypted data so it is readable only on servers that can cryptographically prove they are trustworthy. It is a collaboration between Anthropic and Pattern Labs, presented as early research and not a product forecast.
- Two goals: secure model weights against increasingly capable threat actors (citing a RAND report on securing model weights), and prove to users that sensitive data stays private. The guiding principle is that sensitive data stays encrypted everywhere except the point where it is processed.
- Two components touch cleartext user data: the API Server (turns prompts into tokens, runs most request logic) and the Inference Server (runs the model on accelerators). API Server security is acknowledged as important but out of scope, and for model weights only the Inference Server receives sensitive data.
- Because accelerators do not yet fully support confidential computing, the design introduces a small trusted "model loader and invoker" that accepts encrypted input, decrypts it, sends it to the accelerator, invokes the computation, and returns encrypted results. It is model-architecture agnostic and presents itself to the rest of the system as a "virtual accelerator."
- The loader runs in a separate hypervisor-isolated VM and accepts only programs signed by Anthropic's secure CI server, with code reviewed by multiple engineers before signing.
- Everything else in the Inference Server (which "might change frequently") is untrusted. Confidentiality holds "no matter what the rest of the system does," as long as the loader runs correctly. Minimizing the trusted computing base is the central design move.
- Trusted environment property 1: encrypted memory isolated by hardware from other workloads, protecting against some physical attacks and a malicious hypervisor. Sharing encrypted host memory with an accelerator is not yet well established, so until then Anthropic relies on compute providers for physical datacenter and hypervisor security.
- Properties 2 and 3 are debugging features disabled and cryptographic proof that the correct code is running. They use standard confidential-computing practice with a TPM as the root of trust: measured boot, where the TPM measures each boot stage and reports a final hash that serves as the attestation.
- A keyserver verifies the attestation and releases decryption keys only to an environment it deems trustworthy, concentrating the trust decision there. Anthropic is exploring setups where independent third parties validate the trusted code and run their own keyservers, giving stronger assurances per data owner.
- Request flow: input is encrypted before reaching Anthropic; the API Server decrypts, tokenizes and processes, then re-encrypts; the Inference Server handles it only in encrypted form; it is decrypted only inside the trusted loader, which feeds the accelerator; completions are encrypted before leaving the loader and returned via the API Server.
- Weights are stored encrypted, decrypted only at the loader, and never released from it.
- Limitations: not all accelerators support confidential computing, encrypted accelerator memory sharing is immature, it depends on cloud providers for physical and hypervisor security, and it is early-stage research. Performance overhead, GPU/TPU specifics, key algorithms, and rotation are not described (an NVIDIA H100 confidential-computing reference is linked).
- Future directions: as models grow more capable, the loader layer can host additional safeguards such as egress bandwidth limits on servers holding cleartext weights (tied to ASL-3 protections) and requiring a safety classifier's signature before inference is allowed to run.
- The article makes a call to hardware designers to build confidential computing and a hardware root of trust into accelerators, which would shrink the trust boundary further.

## Harness implications
- [component:actionClassifier] Keep the policy enforcer a small, reviewed trusted core and treat the frequently changing rest of the harness as untrusted.
  > Everything else in the Inference Server (which "might change frequently") is untrusted.
- [foundation:secretsOutside] Make secrets usable only at the component that needs them; tools and subagents get handles or scoped tokens, never raw secrets.
  > sensitive data stays encrypted everywhere except the point where it is processed
- [foundation:effectiveConfig] Record the version of every tool, prompt and harness component in each run so it can be audited against what was supposed to run.
  > cryptographic proof that the correct code is running
- [component:stageLessons] Let only reviewed, trusted content reach the prompts, the way only signed code runs in the trusted layer.
  > accepts only programs signed by Anthropic's secure CI server
- [component:actionClassifier] Concentrate trust decisions in one auditable place and log every decision.
  > concentrating the trust decision there
- [component:actionClassifier] Disable escape hatches such as unrestricted shell by default in unattended modes and make the mode visible.
  > debugging features disabled
- [component:osSandbox] Run agent tools in an isolated sandbox whose egress destinations and bandwidth are limited and logged.
  > egress bandwidth limits on servers holding cleartext weights
- [component:actionClassifier] Let a high-risk action proceed only after a classifier has signed off, with the verdict kept in the trace.
  > requiring a safety classifier's signature before inference is allowed to run
- [foundation:eventLog] Export audit logs that the user or a third party can check against the code and policies that governed the session.
  > independent third parties validate the trusted code and run their own keyservers
