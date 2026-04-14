# Phase 18: Parallel Inference Pipeline - Research

**Researched:** 2026-04-14
**Domain:** Concurrent multi-model inference orchestration (TypeScript + vLLM + Vercel AI SDK)
**Confidence:** HIGH

## Summary

Phase 18 introduces concurrent model calls to separate vLLM backends so that lightweight 9B models handle fast pre-processing tasks (intent classification, log pattern extraction) while the 122B model performs deep reasoning -- overlapping in time rather than running sequentially. The codebase already has all the building blocks: per-role ModelRegistry with per-baseUrl provider caching (`openai-compat.ts`), `Promise.allSettled` patterns in `discovery.ts`, worker model calls in `noise-filter.ts` and `intent-classifier.ts`, and the health route already probes multiple backends. The work is primarily an orchestration layer that coordinates these existing pieces into parallel pipelines with timing instrumentation and graceful sequential fallback.

The existing `ModelMapEntry` type already supports per-role `{ model, baseUrl }` objects, meaning no config schema changes are needed -- users can already point different roles at different vLLM instances. The `createModelRegistry` function in `openai-compat.ts` already caches providers by baseUrl. What is missing is: (1) a backend availability checker that determines which backends are online at pipeline start, (2) a parallel inference coordinator that launches concurrent model calls via `Promise.allSettled`, (3) timing instrumentation to prove overlapping execution, and (4) graceful fallback to sequential mode when only one backend is available.

**Primary recommendation:** Build a thin `InferenceScheduler` that wraps the existing ModelRegistry, probes backend availability at pipeline start, and orchestrates concurrent `generateObject`/`generateText` calls via `Promise.allSettled`. The pipeline already calls worker model for noise filtering and compaction -- Phase 18 moves those calls to overlap with the 122B diagnosis call. No new dependencies needed.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFER-01 | Concurrent model calls to different vLLM backends via `Promise.allSettled()` | Existing ModelRegistry supports per-role baseUrl; Promise.allSettled already used in discovery.ts; InferenceScheduler wraps this pattern for model calls |
| INFER-02 | Pipeline stages: 9B intent classification (<200ms) -> 122B deep reasoning | Intent classifier already exists in memory/intent-classifier.ts; needs timing gate and pipeline stage sequencing |
| INFER-03 | 9B pre-processes logs and extracts error patterns while 122B reasons about diagnosis | noise-filter.ts and compactor.ts already use workerModel; restructure pipeline to launch these concurrently with diagnosis |
| INFER-04 | Separate vLLM instances per model size (no VRAM contention on single GPU) | ModelMapEntry already supports { model, baseUrl }; health route already probes multiple backends; needs VRAM config documentation |
| INFER-05 | Fallback to sequential inference when only single backend available | Backend probe at pipeline start determines mode; sequential path is current behavior (zero changes needed) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (Vercel AI SDK) | ^6.0.116 | `generateObject`, `generateText`, `streamText` for all LLM calls | Already in use; supports concurrent calls to different model instances natively |
| @ai-sdk/openai-compatible | ^2.0.35 | OpenAI-compatible provider connecting to vLLM backends | Already in use; provider cache by baseUrl already implemented |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| p-queue | ^9.1.2 | Concurrency control (already used for discovery mutex) | NOT needed for inference parallelism -- Promise.allSettled is sufficient |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Promise.allSettled | p-queue with concurrency control | Overkill -- we want maximum parallelism between 9B and 122B, not rate limiting |
| Custom scheduler | bullmq/temporal | Massive overkill for 2-3 concurrent calls; adds runtime dependency |
| vLLM multi-model single instance | Separate vLLM instances | vLLM does NOT natively serve multiple models in one process; separate instances with `--gpu-memory-utilization` splitting is the standard approach |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  orchestrator/
    inference-scheduler.ts    # NEW: Backend probe + parallel dispatch
    inference-types.ts        # NEW: InferenceTask, InferenceResult, BackendStatus types
    pipeline.ts               # MODIFIED: Use InferenceScheduler for parallel model calls
  llm/
    openai-compat.ts          # UNCHANGED: Provider cache already works per-baseUrl
    provider.ts               # MINOR: Add timing wrapper for dev-mode logs
  config/
    types.ts                  # UNCHANGED: ModelMapEntry already supports { model, baseUrl }
  api/routes/
    health.ts                 # ENHANCED: Expose backend status for scheduler consumption
```

### Pattern 1: InferenceScheduler (Backend-Aware Parallel Dispatch)
**What:** A lightweight coordinator that probes backend availability at pipeline start and dispatches model calls to the appropriate backends concurrently.
**When to use:** At the start of every `runDPEV` call.
**Example:**
```typescript
// Source: Designed from existing codebase patterns

export interface BackendStatus {
  baseUrl: string;
  available: boolean;
  models: string[];
  responseTimeMs: number;
}

export interface InferenceScheduler {
  /** Probe all configured backends, cache results for session */
  probeBackends(): Promise<BackendStatus[]>;

  /** Check if a specific role's backend is available */
  isAvailable(role: ModelRole): boolean;

  /** Get execution mode based on available backends */
  getMode(): 'parallel' | 'sequential';

  /** Run multiple inference tasks concurrently via Promise.allSettled */
  runParallel<T>(tasks: InferenceTask<T>[]): Promise<SettledResult<T>[]>;
}

export interface InferenceTask<T> {
  label: string;           // For timing logs: "9B-intent", "122B-diagnosis"
  role: ModelRole;         // Maps to registry.get(role)
  execute: () => Promise<T>;
}
```

### Pattern 2: Pipeline Stage Restructuring
**What:** Reorganize the DPEV pipeline so 9B tasks (noise filtering, intent classification, log pattern extraction) run concurrently with 122B diagnosis.
**When to use:** When scheduler reports `parallel` mode.
**Example:**
```typescript
// Current sequential flow in pipeline.ts:
// 1. Skill selection (triage model - 9B) -- fast, keeps sequential
// 2. Parallel discovery (shell commands)
// 3. Noise filter (worker model - 9B)        \
// 4. Context compaction (worker model - 9B)    |-- These become concurrent with 5
// 5. Diagnosis (forensic/strategic - 122B)    /

// New parallel flow:
// 1. Skill selection (triage - 9B) -- <200ms, sequential gate
// 2. Parallel discovery (shell commands)
// 3. Concurrent:
//    a. 9B pre-processing: noise filter + compaction + log pattern extraction
//    b. 122B diagnosis: runs with partial context, enriched on completion
// 4. Merge results: 9B pre-processed context enriches 122B output
```

### Pattern 3: Graceful Sequential Fallback (INFER-05)
**What:** When only one backend is available, the pipeline runs in its current sequential mode transparently.
**When to use:** Single vLLM backend, or when the 9B backend is down.
**Example:**
```typescript
// Source: Designed from existing health route pattern

const scheduler = createInferenceScheduler(config, registry);
const backends = await scheduler.probeBackends();
const mode = scheduler.getMode(); // 'parallel' or 'sequential'

if (mode === 'parallel') {
  // Launch 9B pre-processing and 122B diagnosis concurrently
  const [preProcess, diagnosis] = await Promise.allSettled([
    run9BPreProcessing(filteredRaw, workerModel),
    run122BDiagnosis(enrichedPrompt, systemPrompt, provider, preferredRole),
  ]);
  // Merge results...
} else {
  // Current sequential flow -- zero changes to existing behavior
  // This IS the fallback: the existing pipeline.ts code
}
```

### Pattern 4: Timing Instrumentation
**What:** Dev-mode timing logs that prove overlapping execution by showing start/end timestamps for each model call.
**When to use:** Always in dev mode (DEV_MODE = process.env.NODE_ENV !== 'production').
**Example:**
```typescript
// Source: Existing DEV_MODE pattern in pipeline.ts

if (DEV_MODE) {
  console.log(`[INFERENCE] Mode: ${mode}`);
  console.log(`[INFERENCE] 9B pre-processing started at ${t0}ms`);
  console.log(`[INFERENCE] 122B diagnosis started at ${t1}ms`);
  console.log(`[INFERENCE] 9B pre-processing completed at ${t2}ms (${t2-t0}ms)`);
  console.log(`[INFERENCE] 122B diagnosis completed at ${t3}ms (${t3-t1}ms)`);
  console.log(`[INFERENCE] Overlap: ${Math.max(0, t2-t1)}ms`);
  console.log(`[INFERENCE] Total: ${t3-t0}ms (sequential would be: ${(t2-t0)+(t3-t1)}ms)`);
}
```

### Anti-Patterns to Avoid
- **Shared state between parallel tasks:** The 9B noise filter and 122B diagnosis must NOT share mutable state. Each gets its own copy of discovery context.
- **Waiting for 9B before launching 122B:** The whole point is overlap. Launch 122B with raw/partially-processed context immediately, not after 9B completes.
- **Retrying failed parallel calls inside allSettled:** If the 9B task fails, fall back to sequential. Do NOT retry -- the fallback IS the retry.
- **VRAM contention by running models on same backend:** Each model size MUST be on its own vLLM instance (different port, controlled `--gpu-memory-utilization`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Backend health checking | Custom HTTP probe logic | Reuse `extractUniqueBackendUrls` + fetch pattern from `health.ts` | Already tested, handles timeouts and error cases |
| Provider per-backend | Manual provider creation per call | `createModelRegistry` in `openai-compat.ts` with providerCache | Already deduplicates providers by baseUrl |
| Concurrent async orchestration | Custom event emitter / worker threads | `Promise.allSettled()` | Native JS, already used in `discovery.ts`, handles mixed success/failure |
| Model role resolution | Hardcoded model names | `registry.get(role)` | Already abstracts model-to-backend mapping |
| Config schema for multi-backend | New config section | Existing `ModelMapEntry` union type (`string \| { model, baseUrl }`) | Schema already supports per-role baseUrl |

**Key insight:** The existing codebase already has 90% of the infrastructure for parallel inference. The ModelRegistry, provider caching, health probing, and Promise.allSettled patterns are all in place. Phase 18 is primarily a **coordination** task, not an infrastructure task.

## Common Pitfalls

### Pitfall 1: Context Race Condition
**What goes wrong:** The 122B diagnosis needs enriched context (noise-filtered, compacted), but noise filtering is a 9B task that runs in parallel.
**Why it happens:** If you wait for 9B to finish before launching 122B, you lose all parallelism.
**How to avoid:** Launch 122B with raw discovery context immediately. The 9B pre-processing enriches the NEXT pipeline stage (planning), not the diagnosis itself. Alternatively, split into: (a) fast 9B tasks that MUST complete before 122B (intent classification <200ms) and (b) slow 9B tasks that run alongside 122B (detailed log analysis).
**Warning signs:** No timing overlap in dev logs; 122B waiting on 9B results.

### Pitfall 2: VRAM Contention on Single GPU
**What goes wrong:** Two vLLM instances compete for GPU memory, causing OOM or severe slowdown.
**Why it happens:** Default `--gpu-memory-utilization=0.9` leaves only 10% for a second instance.
**How to avoid:** Configure each vLLM instance with explicit `--gpu-memory-utilization`. For a single GPU: 9B instance at 0.15-0.20 (Qwen3.5:9B needs ~6GB at FP16), 122B instance at 0.70-0.75 (Qwen3.5:122B-A10B MoE needs ~70GB+ at Q4). For multi-GPU setups, use `CUDA_VISIBLE_DEVICES` to isolate GPUs.
**Warning signs:** vLLM instance fails to start; "CUDA out of memory" errors; health check shows backend as disconnected.

### Pitfall 3: Fallback Mode Producing Different Results
**What goes wrong:** Sequential mode returns different results than parallel mode because the pipeline structure differs.
**Why it happens:** Parallel mode might skip certain enrichment steps or use different context ordering.
**How to avoid:** Sequential mode MUST be identical to current pipeline behavior. Test both modes with the same inputs and verify identical outputs (minus timing differences).
**Warning signs:** Tests that pass in parallel mode but fail in sequential mode.

### Pitfall 4: Health Probe Latency Blocking Pipeline Start
**What goes wrong:** The backend probe at pipeline start adds 3+ seconds of latency before any inference begins.
**Why it happens:** Probing multiple backends with 3-second timeouts sequentially.
**How to avoid:** Probe all backends in parallel (Promise.all, not sequential). Cache probe results for a configurable TTL (e.g., 30 seconds) so repeated pipeline calls within a session don't re-probe. If all backends were available on last probe, skip re-probe and just start.
**Warning signs:** First diagnosis request takes 6+ seconds longer than subsequent ones.

### Pitfall 5: Mock Explosion in Tests
**What goes wrong:** Every test file that imports pipeline.ts needs to mock the new inference scheduler + all backends.
**Why it happens:** Deep coupling between pipeline and scheduler.
**How to avoid:** InferenceScheduler as an optional dependency injected via DPEVInput. When not provided, pipeline uses sequential mode (current behavior). Tests only need to provide it when testing parallel paths.
**Warning signs:** 20+ mock declarations at the top of every test file.

## Code Examples

Verified patterns from the existing codebase:

### Current Worker Model Usage (noise-filter.ts)
```typescript
// Source: src/context/noise-filter.ts lines 72-95
// This call currently blocks the pipeline sequentially.
// In Phase 18, it moves to run concurrently with 122B diagnosis.
if (unrecognized.length >= WORKER_MODEL_THRESHOLD && workerModel != null) {
  const { object } = await generateObject({
    model: workerModel,
    schema: z.object({ relevant: z.array(z.string()) }),
    prompt: `...lines...`,
  });
}
```

### Current Intent Classification (9B model)
```typescript
// Source: src/memory/intent-classifier.ts lines 78-86
// This is the <200ms classification that becomes the pipeline gate.
export async function classifyIntent(
  prompt: string,
  workerModel: LanguageModel,
): Promise<IntentResult> {
  const { object } = await generateObject({
    model: workerModel,
    schema: IntentSchema,
    system: buildClassifierSystemPrompt(),
    prompt,
  });
  return object;
}
```

### Current Health Route Backend Probe
```typescript
// Source: src/api/routes/health.ts lines 40-67
// This pattern is reused in InferenceScheduler.probeBackends()
const backends: BackendHealth[] = await Promise.all(
  backendUrls.map(async (baseUrl): Promise<BackendHealth> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const start = Date.now();
      const response = await fetch(`${baseUrl}/models`, {
        signal: controller.signal,
      });
      const elapsed = Date.now() - start;
      clearTimeout(timeout);
      const data = await response.json();
      return { baseUrl, connected: true, models, responseTimeMs: elapsed };
    } catch (err) {
      return { baseUrl, connected: false, error: err.message };
    }
  }),
);
```

### ModelMapEntry Per-Role BaseUrl (already supported)
```json
// Source: config.json (current production config)
// The schema already supports per-role baseUrl via ModelMapEntry union type.
// Phase 18 just documents how to use it for parallel inference.
{
  "modelMap": {
    "default": "qwen3.5:35b-a3b",
    "triage": "qwen3.5:9b",
    "strategic": { "model": "qwen3.5:122b-a10b", "baseUrl": "http://localhost:8000/v1" },
    "worker": { "model": "glm-4.7-flash", "baseUrl": "http://localhost:8001/v1" },
    "embedding": "bge-m3"
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single Ollama instance (one model in VRAM) | vLLM multi-model with `--gpu-memory-utilization` splitting | Phase 13.1 (2026-03-17) added multi-backend support | Enables true parallel inference |
| Sequential noise filter -> diagnosis | Concurrent 9B pre-processing + 122B reasoning | Phase 18 (this phase) | Cuts total inference time by overlap |
| vLLM single model per GPU | vLLM `--gpu-memory-utilization` per instance on shared GPU | vLLM 2024+ | MoE models (Qwen3.5:122B-A10B) only activate 10B params, so VRAM for weights is manageable |

**Deprecated/outdated:**
- Ollama single-model-in-VRAM: Replaced by vLLM multi-model in Phase 13.1
- Sequential-only model calls: Replaced by parallel dispatch in Phase 18

## vLLM Multi-Instance Configuration

### Recommended Setup: Single GPU (48GB+)
```bash
# Instance 1: 9B models (triage, worker) -- low VRAM, fast
CUDA_VISIBLE_DEVICES=0 vllm serve Qwen/Qwen3.5-9B \
  --port 8001 \
  --gpu-memory-utilization 0.20 \
  --max-model-len 32768

# Instance 2: 122B MoE model (strategic, forensic) -- high VRAM, slow
CUDA_VISIBLE_DEVICES=0 vllm serve Qwen/Qwen3.5-122B-A10B \
  --port 8000 \
  --gpu-memory-utilization 0.75 \
  --max-model-len 32768
```

### Recommended Setup: Multi-GPU (2x 24GB+)
```bash
# GPU 0: 9B models
CUDA_VISIBLE_DEVICES=0 vllm serve Qwen/Qwen3.5-9B \
  --port 8001 \
  --gpu-memory-utilization 0.9

# GPU 1: 122B MoE model (may need tensor parallelism on smaller GPUs)
CUDA_VISIBLE_DEVICES=1 vllm serve Qwen/Qwen3.5-122B-A10B \
  --port 8000 \
  --gpu-memory-utilization 0.9
```

### InfraBrain Config for Multi-Backend
```json
{
  "defaultBaseUrl": "http://localhost:8001/v1",
  "modelMap": {
    "default": "qwen3.5:35b-a3b",
    "triage": { "model": "qwen3.5:9b", "baseUrl": "http://localhost:8001/v1" },
    "worker": { "model": "qwen3.5:9b", "baseUrl": "http://localhost:8001/v1" },
    "strategic": { "model": "qwen3.5:122b-a10b", "baseUrl": "http://localhost:8000/v1" },
    "forensic": { "model": "qwen3.5:122b-a10b", "baseUrl": "http://localhost:8000/v1" },
    "embedding": "bge-m3"
  }
}
```

## Open Questions

1. **9B pre-processing context enrichment strategy**
   - What we know: 9B noise filtering produces cleaner context; 122B diagnosis benefits from cleaner context.
   - What's unclear: Can the 122B produce useful diagnosis with raw (unfiltered) context while 9B filters? Or does 122B quality degrade significantly without noise filtering?
   - Recommendation: Run both approaches, measure 122B diagnosis quality. If raw context is "good enough", full overlap is possible. If not, sequence noise filter before 122B (still overlap log pattern extraction).

2. **Timing threshold for pipeline stage gate**
   - What we know: INFER-02 requires intent classification <200ms before 122B starts.
   - What's unclear: On cold vLLM, first inference can take 2-5 seconds (model loading). Does the <200ms apply to warm or cold?
   - Recommendation: Define <200ms as warm-cache latency. Add a health probe that counts "first call" warmup as a one-time cost, not a pipeline SLA.

3. **Single GPU VRAM budget for 9B + 122B MoE**
   - What we know: Qwen3.5-9B at FP16 needs ~12GB. Qwen3.5-122B-A10B is MoE with 10B active params but full weights are ~70-80GB at Q4.
   - What's unclear: Whether a single 48GB GPU (RTX 6000 Ada) can run both simultaneously with acceptable KV cache.
   - Recommendation: For single GPU <80GB, run only the 9B on the same GPU; serve 122B from a separate GPU or RunPod. The config already supports per-role baseUrl for remote backends.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/orchestrator/inference-scheduler.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFER-01 | Concurrent model calls via Promise.allSettled | unit | `npx vitest run tests/orchestrator/inference-scheduler.test.ts -t "concurrent"` | Wave 0 |
| INFER-02 | 9B intent classification <200ms before 122B | unit | `npx vitest run tests/orchestrator/inference-scheduler.test.ts -t "pipeline stages"` | Wave 0 |
| INFER-03 | 9B log pre-processing concurrent with 122B diagnosis | integration | `npx vitest run tests/orchestrator/pipeline.test.ts -t "parallel inference"` | Wave 0 |
| INFER-04 | Multiple backends without VRAM contention | unit | `npx vitest run tests/api/health.test.ts -t "multiple backends"` | Existing (partial) |
| INFER-05 | Sequential fallback when single backend | unit + integration | `npx vitest run tests/orchestrator/inference-scheduler.test.ts -t "fallback"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/orchestrator/inference-scheduler.test.ts tests/orchestrator/pipeline.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/orchestrator/inference-scheduler.test.ts` -- covers INFER-01, INFER-02, INFER-05
- [ ] Pipeline test additions in `tests/orchestrator/pipeline.test.ts` -- covers INFER-03
- [ ] Health test additions in `tests/api/health.test.ts` -- covers INFER-04 backend status caching

*(Existing test infrastructure -- vitest, supertest, mocking patterns -- is fully sufficient. No new test framework needed.)*

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/llm/openai-compat.ts` -- ModelRegistry with per-baseUrl provider cache
- Existing codebase: `src/orchestrator/pipeline.ts` -- Current sequential DPEV flow
- Existing codebase: `src/orchestrator/discovery.ts` -- Promise.allSettled pattern
- Existing codebase: `src/api/routes/health.ts` -- Multi-backend probe logic
- Existing codebase: `src/memory/intent-classifier.ts` -- 9B worker model call pattern
- Existing codebase: `src/context/noise-filter.ts` -- Worker model for relevance scoring
- Existing codebase: `src/config/types.ts` -- ModelMapEntry union supporting per-role baseUrl
- [vLLM Parallelism and Scaling docs](https://docs.vllm.ai/en/stable/serving/parallelism_scaling/)
- [vLLM GPU Memory Utilization](https://docs.vllm.ai/projects/vllm-omni/en/latest/configuration/gpu_memory_utilization/)

### Secondary (MEDIUM confidence)
- [vLLM multiple models per GPU discussion](https://github.com/vllm-project/vllm/issues/13633) -- gpu_memory_utilization splitting pattern
- [Parallel Multi-Model Hosting with vLLM (Medium)](https://dineshr1493.medium.com/parallel-async-multi-model-hosting-with-vllm-4919ba283ce1) -- Port configuration and memory allocation patterns
- [Qwen3.5 9B VRAM requirements](https://apxml.com/models/qwen35-9b) -- ~12GB FP16, ~5GB Q4
- [Vercel AI SDK generateObject docs](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object)

### Tertiary (LOW confidence)
- Single GPU 9B+122B MoE co-hosting feasibility -- needs benchmarking on actual hardware

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already in use, no new dependencies
- Architecture: HIGH -- All building blocks exist in codebase, just need coordination layer
- Pitfalls: HIGH -- VRAM contention and fallback mode are well-documented patterns
- vLLM multi-instance config: MEDIUM -- verified approach but exact VRAM splits depend on hardware

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable patterns, vLLM and AI SDK versions unlikely to change)
