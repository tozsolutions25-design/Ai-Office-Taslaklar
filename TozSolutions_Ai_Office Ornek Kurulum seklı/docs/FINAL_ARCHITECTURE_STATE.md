# TOZ AI OFFICE — FINAL ARCHITECTURE STATE

**Date:** 2026-10-06  
**Status:** Frozen & Audited (`PRODUCTION READY`)  

---

## 1. Layering Hierarchy

```
core  ←  design-system  ←  site
core  ←  orchestration
```

* **`src/core`**: Provider, model, queue, retry, health, audit, state, config (independent foundation).
* **`src/design-system`**: Design tokens, CSS primitives, and components.
* **`src/site`**: Static site generator and documentation/landing renderer.
* **`src/orchestration`**: The composition and execution layer (`TozOrchestrator`, agent registry, capability matcher, workflow engine, memory provider).

---

## 2. Core Architectural Principles

1. **Single Execution Authority (`TozOrchestrator`):**  
   Every task execution, lifecycle transition, and subtask wave flows through `TozOrchestrator`. No competing orchestrators or background schedulers exist outside this authority.

2. **Domain Separation:**  
   Strict distinction between Agent, Capability, Provider, Model, Tool, Memory, and Verification. Neither concept is conflated with another.

3. **Workspace & Tenant Isolation (`Phase 06` & `Phase 12`):**  
   All state stores, checkpoints, approval gates, and attempts are strictly namespaced and partitioned by verified workspace identity.

4. **Security & Redaction:**  
   Unified audit sinks automatically redact sensitive fields and credentials. Approval gates are cryptographically/content-bound to prevent replay or cross-task leaks.

5. **Local-First & Zero-Cost:**  
   The system runs entirely process-locally in Node.js with zero mandatory external API dependencies or cloud billing requirements.
