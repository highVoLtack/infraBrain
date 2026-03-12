# Day 0 & Ecosystem Architecture Research

**Project:** InfraBrain v2.0+ Vision
**Researched:** 2026-03-12
**Overall Confidence:** MEDIUM (mix of proven components and aspirational integration)
**Mode:** Feasibility + Architecture

---

## Executive Summary

This document validates four architectural pillars for InfraBrain's enterprise deployment model and the LoRA production pipeline. The research finds that each pillar is technically feasible with proven, production-grade tooling. However, the integration layer -- wiring these components into a cohesive "Day 0 to steady-state" experience -- is where the real engineering risk lives. No single open-source project does all four pillars together; InfraBrain would be assembling a novel combination from well-understood parts.

The strongest pillar is **Skill & LoRA Distribution** (OCI registries are mature, ORAS is CNCF-backed, vLLM multi-LoRA is production-ready). The most complex pillar is **Day 0 Discovery** (many heterogeneous targets, security/credential management, enterprise network diversity). The LoRA production pipeline is validated but requires significant infrastructure investment (GPU compute, training pipeline tooling, quality assurance).

Key finding: the air-gap constraint is satisfiable across all pillars. Qdrant runs as a single binary, OCI registries can be self-hosted via Harbor/Zot, vLLM runs fully offline, and all discovery tools operate locally. The architecture is coherent.

---

## Pillar 1: Skill & LoRA Distribution Model ("App Store")

### Feasibility: PROVEN

**Recommended Pattern: OCI Registry + ORAS CLI**

The OCI (Open Container Initiative) ecosystem has matured beyond container images into a general-purpose artifact distribution system. LoRA adapters (.safetensors, 60-243 MB) and Skill packs (Markdown bundles) are ideal candidates for OCI artifacts.

### Technology Stack

| Component | Tool | Version | Purpose | Confidence |
|-----------|------|---------|---------|------------|
| Registry Protocol | OCI Distribution Spec | v1.1.1 | Wire protocol for push/pull | HIGH |
| CLI Client | ORAS | v1.3.0 | Push/pull artifacts to registry | HIGH |
| Self-Hosted Registry (air-gap) | Zot | v2.1+ | Single-binary OCI-native registry | HIGH |
| Self-Hosted Registry (enterprise) | Harbor | v2.12+ | Full-featured registry with RBAC, scanning, replication | HIGH |
| Artifact Signing | Cosign (Sigstore) | v2.x | Sign and verify artifact integrity | HIGH |

### How It Works

```
Master Repo (InfraBrain Lab)                    Customer Site
┌──────────────────────────┐                    ┌──────────────────────────┐
│  Harbor Registry          │                    │  Zot Registry (air-gap)  │
│                           │   oras push/pull   │  OR Harbor Satellite     │
│  registry.infrabrain.io/  │◄──────────────────►│  local.registry/         │
│    skills/nginx-diagnose  │   (online) or      │    skills/nginx-diagnose │
│    skills/sap-hana-debug  │   USB sneakernet    │    loras/sap-hana-r16   │
│    loras/sap-hana-r16     │   (air-gap)        │                          │
│    loras/cisco-ios-r32    │                    │  Engine pulls from local │
└──────────────────────────┘                    └──────────────────────────┘
```

### ORAS Artifact Structure

```bash
# Push a LoRA Expert Pack
oras push registry.infrabrain.io/loras/sap-hana:v1.2.0 \
  --artifact-type application/vnd.infrabrain.lora.v1 \
  adapter.safetensors:application/vnd.safetensors \
  adapter_config.json:application/json \
  manifest.yaml:application/yaml

# Push a Skill Pack
oras push registry.infrabrain.io/skills/sap-hana:v3.0.0 \
  --artifact-type application/vnd.infrabrain.skill.v1 \
  sap-hana-diagnose.md:text/markdown \
  sap-hana-fix.md:text/markdown \
  metadata.yaml:application/yaml

# Pull at customer site
oras pull local.registry/loras/sap-hana:v1.2.0 -o /opt/infrabrain/loras/
```

### Air-Gap Distribution

For fully air-gapped environments:

1. **Online side:** `oras pull` from master registry to staging machine
2. **Transfer:** `oras cp` to an OCI layout on USB/external drive, or `oras export` to tarball
3. **Offline side:** `oras import` or `oras push` to local Zot instance
4. **Harbor Satellite:** Purpose-built for edge/air-gap scenarios -- lightweight standalone registry that syncs when connectivity is available

### Registry Choice

| Scenario | Registry | Why |
|----------|----------|-----|
| Air-gapped, minimal ops | **Zot** | Single static binary (~20MB), zero dependencies, OCI-native, no database needed |
| Enterprise with RBAC/audit | **Harbor** | CNCF graduated, LDAP/OIDC auth, vulnerability scanning, replication policies |
| Cloud-connected customers | **Harbor Cloud** or **GitHub Container Registry** | Managed, no ops burden |

### Security Considerations

- **Artifact signing with Cosign:** Every LoRA and Skill pack signed with InfraBrain's key before distribution. Customer engine verifies signature before loading. Prevents supply-chain tampering.
- **Content hashing:** OCI artifacts are content-addressable (SHA-256 digest). Tamper-evident by design.
- **RBAC:** Harbor supports per-project access control. Customer A cannot pull Customer B's custom LoRAs.
- **Network:** Zot can bind to localhost only. No external exposure needed after initial sync.

### What Needs Building

- `src/registry/client.ts` -- ORAS SDK wrapper (or shell out to `oras` CLI) for push/pull/verify
- `manifest.yaml` schema for Skill Packs and LoRA Expert Packs (version, compatibility, base model, rank, target modules)
- Auto-provisioning logic in Day 0 wizard that maps detected tech stack to registry artifact tags

---

## Pillar 2: Day 0 Setup Wizard & Deep Scan

### Feasibility: VALIDATED (components proven individually, integration is custom)

### Discovery Agent Architecture

The `/infra:setup` command spawns domain-specific Discovery Agents that build the initial Knowledge DB. Each agent is a specialized scanner.

### Discovery Tools

| Agent | Tool | Node.js Integration | Maturity | Confidence |
|-------|------|---------------------|----------|------------|
| Network Scanner | **Nmap** (system binary) | `node-nmap` (TypeScript rewrite) or `child_process` spawn | 25+ years, industry standard | HIGH |
| AD/LDAP Crawler | **ldapts** | Native npm, TypeScript, async/await | Active, 148K weekly downloads | MEDIUM |
| Docker Inspector | **dockerode** | Native npm, feature-complete | Stable, mirrors Docker API 1:1 | HIGH |
| Kubernetes Inspector | **@kubernetes/client-node** | Official K8s JS client | Official, TypeScript | HIGH |
| DNS/Service Discovery | Node.js `dns` module + custom | Built-in | N/A | HIGH |
| SNMP Discovery | **net-snmp** | Native npm | Stable | MEDIUM |

### Critical Detail: ldapjs Decommissioned

**ldapjs was decommissioned as of 2025-04-01.** The replacement is **ldapts** (TypeScript-native, promise-based, 148K weekly downloads). The `activedirectory2` npm package (built on ldapjs) should NOT be used for new development. Instead, use ldapts directly with AD-specific LDAP queries.

```typescript
// Discovery Agent: AD Crawler using ldapts
import { Client } from 'ldapts';

const client = new Client({ url: 'ldaps://dc.customer.local:636' });
await client.bind('CN=InfraBrain,OU=Service Accounts,DC=customer,DC=local', password);

// Enumerate OUs, computers, groups
const { searchEntries } = await client.search('DC=customer,DC=local', {
  scope: 'sub',
  filter: '(objectClass=computer)',
  attributes: ['cn', 'operatingSystem', 'operatingSystemVersion', 'dNSHostName'],
});
```

### Nmap Integration Pattern

Nmap should be invoked as a system binary (not reimplemented). The Node.js wrapper parses XML output.

```typescript
// Discovery Agent: Network Scanner
// Requires nmap installed on system (bundled in standalone binary or documented prereq)
import { exec } from 'child_process';

// Phase 1: Host discovery (fast, ~30 seconds for /24)
// -sn = ping scan, no port scan
exec('nmap -sn 192.168.1.0/24 -oX -', (err, stdout) => { /* parse XML */ });

// Phase 2: Service detection on discovered hosts (slower, ~5-10 min for 50 hosts)
// -sV = service version detection
exec('nmap -sV -T4 --top-ports 1000 -oX - 192.168.1.10-50', (err, stdout) => { /* parse XML */ });
```

### Docker/Kubernetes Discovery

```typescript
// Docker: via dockerode
import Docker from 'dockerode';
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const containers = await docker.listContainers({ all: true });
const networks = await docker.listNetworks();
const volumes = await docker.listVolumes();

// Kubernetes: via official client
import * as k8s from '@kubernetes/client-node';
const kc = new k8s.KubeConfig();
kc.loadFromDefault(); // reads ~/.kube/config or in-cluster config
const coreV1 = kc.makeApiClient(k8s.CoreV1Api);
const nodes = await coreV1.listNode();
const services = await coreV1.listServiceForAllNamespaces();
const pods = await coreV1.listPodForAllNamespaces();
```

### Day 0 Scan Output: Topology Graph

The scan produces a structured topology stored in SQLite (queryable) and as TOON-encoded file (LLM-consumable):

```yaml
# topology.yaml (human-readable export)
infrastructure:
  networks:
    - name: "production"
      cidr: "10.0.1.0/24"
      hosts:
        - ip: "10.0.1.10"
          hostname: "sap-hana-prod"
          os: "SUSE Linux Enterprise 15 SP5"
          services:
            - port: 30015
              service: "SAP HANA"
              version: "2.0 SP07"
          tags: ["sap", "database", "critical"]
        - ip: "10.0.1.20"
          hostname: "nginx-lb-01"
          os: "Ubuntu 22.04"
          services:
            - port: 443
              service: "nginx"
              version: "1.24.0"
          tags: ["webserver", "loadbalancer"]
  active_directory:
    domain: "customer.local"
    domain_controllers: ["dc01.customer.local", "dc02.customer.local"]
    ous: ["IT", "Finance", "Munich", "Berlin"]
    computer_count: 847
    user_count: 1203
  kubernetes:
    clusters:
      - name: "prod-cluster"
        version: "1.29"
        nodes: 12
        namespaces: ["default", "kube-system", "monitoring", "app-prod"]
```

### Security Considerations

- **Credential management:** Discovery agents need credentials (AD bind account, kubeconfig, Docker socket access). These must NEVER be stored in plain text. Use OS keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager) via `keytar` npm package, or environment variables.
- **Least privilege:** AD service account needs only READ access. Docker socket access implies root-equivalent -- document this risk. K8s RBAC should scope to read-only ClusterRole.
- **Scan impact:** Nmap `-T4` timing is aggressive. For production networks, default to `-T3` (normal) and let admin override. Service version detection (`-sV`) sends probes that some IDS systems flag.
- **Data classification:** The topology DB contains sensitive infrastructure data. Encrypt at rest (SQLite with sqlcipher or application-level encryption). Mark as "CONFIDENTIAL" in audit metadata.

### What Needs Building

- `src/discovery/scanner.ts` -- orchestrates all agents, merges results
- `src/discovery/agents/network.ts` -- Nmap wrapper with XML parser
- `src/discovery/agents/ldap.ts` -- AD/LDAP crawler using ldapts
- `src/discovery/agents/docker.ts` -- Docker socket inspector
- `src/discovery/agents/kubernetes.ts` -- K8s API inspector
- `src/discovery/topology.ts` -- unified topology model + SQLite storage
- `/infra:setup` CLI command wiring

---

## Pillar 3: Auto-Provisioning from System Analysis

### Feasibility: VALIDATED (straightforward once Pillar 1 + 2 exist)

This pillar is the glue between Day 0 Discovery (Pillar 2) and the Registry (Pillar 1). It maps detected technology to required Skills and LoRAs.

### Matching Algorithm

```typescript
// src/provisioning/matcher.ts
interface TechSignature {
  service: string;      // "SAP HANA", "nginx", "Cisco IOS"
  version?: string;
  confidence: number;   // 0-1, from Nmap service detection
}

interface ExpertPack {
  artifact: string;     // "registry.infrabrain.io/loras/sap-hana:v1.2.0"
  skills: string[];     // ["skills/sap-hana-diagnose:v3.0.0", "skills/sap-hana-fix:v2.1.0"]
  requiredBaseModel: string; // "qwen2.5-coder:32b"
  loraRank: number;     // 16
  sizeBytes: number;    // 62914560 (60MB)
}

// Mapping table -- ships with engine, updated from registry
const TECH_TO_PACKS: Record<string, ExpertPack[]> = {
  "SAP HANA": [{ artifact: "loras/sap-hana:v1.2.0", ... }],
  "nginx":    [{ artifact: "loras/nginx-expert:v2.0.0", ... }],
  "Cisco IOS": [{ artifact: "loras/cisco-ios:v1.0.0", ... }],
};

function matchTechToExpertPacks(topology: Topology): ProvisioningPlan {
  const detected = topology.allServices(); // from Day 0 scan
  const packs = detected.flatMap(tech => TECH_TO_PACKS[tech.service] ?? []);
  const deduplicated = uniqueBy(packs, p => p.artifact);
  const totalSize = deduplicated.reduce((sum, p) => sum + p.sizeBytes, 0);
  return { packs: deduplicated, totalDownloadSize: totalSize };
}
```

### Provisioning Flow

```
Day 0 Scan Complete
       │
       ▼
┌─────────────────┐
│ Topology Analysis│
│ "Found: SAP HANA│
│  nginx, Docker,  │
│  Active Directory│
│  Cisco switches" │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────────┐
│ Matching Engine  │────►│ Provisioning Plan    │
│ tech → packs    │     │                     │
└─────────────────┘     │ - SAP HANA LoRA 60MB│
                        │ - nginx LoRA    60MB│
                        │ - Cisco LoRA    60MB│
                        │ - 6 Skill packs      │
                        │ Total: ~180MB        │
                        └─────────┬───────────┘
                                  │
                                  ▼
                        ┌─────────────────────┐
                        │ HITL Approval Gate   │
                        │ "Download 180MB of   │
                        │  Expert Packs?       │
                        │  [Y/N] [Show details]│
                        └─────────┬───────────┘
                                  │ (Y)
                                  ▼
                        ┌─────────────────────┐
                        │ ORAS Pull + Verify   │
                        │ - Signature check    │
                        │ - Integrity verify   │
                        │ - Place in loras/    │
                        │   and skills/ dirs   │
                        └─────────────────────┘
```

### Security Considerations

- **HITL gate is mandatory.** Auto-downloading executable-adjacent artifacts (LoRAs influence model behavior) without admin approval is a non-starter for enterprise.
- **Signature verification before loading.** A compromised LoRA could steer model outputs. Cosign verification is not optional.
- **Version pinning.** Provisioning plan should pin exact digests, not just tags. Tags are mutable; digests are not.

### What Needs Building

- `src/provisioning/matcher.ts` -- tech-to-pack mapping
- `src/provisioning/planner.ts` -- generates provisioning plan from topology
- `src/provisioning/executor.ts` -- orchestrates ORAS pull + verification + placement
- Registry catalog sync endpoint (periodic or on-demand)

---

## Pillar 4: Local Knowledge Base (Customer Air-Gap)

### Feasibility: PROVEN

This pillar is already partially validated in PROJECT.md (Section 4: Knowledge Architecture). This research adds air-gap-specific validation and concrete deployment details.

### Qdrant for Air-Gapped Deployment

| Deployment Method | Air-Gap Compatible | Notes |
|-------------------|--------------------|-------|
| **Pre-built binary** | YES | Single binary, ~80MB, download from GitHub releases. No runtime dependencies. |
| **Docker image** | YES | Pre-pull and transfer image via `docker save/load` |
| **Compile from source** | YES | Requires Rust toolchain. Vendor dependencies with `cargo vendor`. |
| **Kubernetes Operator** | YES | Helm chart with pre-pulled images |

**Recommended for InfraBrain: Pre-built binary.** Matches the "standalone binary" distribution philosophy. Bundle Qdrant binary alongside InfraBrain binary.

### Concrete Deployment

```bash
# Air-gapped installation
# 1. On internet-connected machine:
wget https://github.com/qdrant/qdrant/releases/download/v1.13.2/qdrant-x86_64-unknown-linux-gnu.tar.gz
# 2. Transfer to customer site
# 3. Extract and run:
tar xzf qdrant-x86_64-unknown-linux-gnu.tar.gz
./qdrant --config-path /opt/infrabrain/qdrant.yaml
```

### Knowledge Ingestion in Air-Gapped Environment

```
Customer Documents                 Local Embedding           Local Qdrant
(never leave site)                 (bge-m3 via Ollama)       (single binary)

┌────────────────┐   chunk    ┌──────────────────┐  embed   ┌──────────────┐
│ SAP manuals    │───────────►│ Ingestion Pipeline│─────────►│ Vector DB    │
│ AD export      │            │                  │          │              │
│ Internal wikis │            │ 512-token chunks │          │ 1024-dim     │
│ Network docs   │            │ + contextual     │          │ dense + BM25 │
│ Runbooks       │            │   headers        │          │ sparse       │
└────────────────┘            └──────────────────┘          └──────────────┘

100% LOCAL — zero data egress
```

### Storage Budget (realistic enterprise)

| Document Volume | Chunks (~) | Dense Vectors (int8) | HNSW Index | BM25/Sparse | Total Storage |
|-----------------|------------|---------------------|------------|-------------|---------------|
| 10K pages | 100K | ~100 MB | ~50-150 MB | ~20-50 MB | ~200-400 MB |
| 100K pages | 1M | ~1 GB | ~500 MB - 1.5 GB | ~200-500 MB | ~2-4 GB |
| 1M pages | 10M | ~10 GB | ~5-15 GB | ~2-5 GB | ~25-40 GB |

**RAM budget for serving:**

| Scale | RAM Required | Notes |
|-------|-------------|-------|
| 100K chunks | ~500 MB | Fits in any server |
| 1M chunks | ~1.4-3 GB | Scalar quantization keeps it tight |
| 10M chunks | ~3-6 GB | On-disk vectors + quantized index in RAM |

### Security Considerations

- **Data sovereignty:** This is the core selling point. Customer proprietary data (AD structures, network topology, internal documentation) stays on customer hardware. Period.
- **Encryption at rest:** Qdrant does not natively encrypt data files. Options: (1) filesystem-level encryption (LUKS/dm-crypt on Linux, FileVault on macOS, BitLocker on Windows), (2) encrypted NVMe drives (hardware-level). Recommend filesystem-level as default.
- **Access control:** Qdrant supports API key authentication. In single-instance deployment, bind to localhost only. No external network exposure.
- **Data lifecycle:** Customer should be able to purge all InfraBrain knowledge data with a single command. Implement `/infra:purge-knowledge` that deletes Qdrant collections and removes vector storage directory.

### What Needs Building (beyond existing RAG roadmap)

- Air-gap-aware ingestion that handles offline embedding model loading
- `/infra:purge-knowledge` command for data lifecycle management
- Qdrant binary bundling in standalone distribution
- Filesystem encryption documentation for deployment guide

---

## LoRA Production Pipeline Validation

### 4-Step Process Assessment

### Step 1: Raw Ingestion

**Status: PROVEN**

Standard document processing. No novel technology needed.

| Input Format | Tool | Notes |
|--------------|------|-------|
| PDF | `pdf-parse` (npm) or `Docling` (Python, IBM) | Docling handles complex layouts better |
| Markdown | Built-in | Already in the codebase |
| HTML | `cheerio` (npm) | Standard scraping/parsing |
| Confluence/Wiki | REST API export → HTML → text | Customer provides export |

### Step 2: Synthetic Data Generation ("The Alchemist")

**Status: VALIDATED -- tooling exists, quality requires iteration**

The two-stage approach (Claude as Curriculum Architect, Llama 405B as Data Writer) is sound and aligns with industry patterns.

**Validation from research:**

- **NVIDIA Nemotron-4 340B** was specifically designed for synthetic data generation. Demonstrates that teacher-model-based synthetic data pipelines are industry-accepted.
- **InstructLab** (Red Hat/IBM, open source) implements exactly this pattern: structured taxonomy seeds --> teacher LLM generates training data --> fine-tune student model. LAB-trained models outperformed baselines on MT-Bench. This validates the approach.
- **Stratos** (2025 paper) treats synthetic data generation as adaptive: choosing teachers and prompting strategies based on domain coverage. Relevant insight: don't use one prompt template for all scenarios.

**Recommended pipeline:**

```
┌─────────────────────────────────────────────────────────────┐
│  Stage 1: Curriculum Design (Claude Opus)                    │
│                                                              │
│  Input: Domain descriptor + sample docs                      │
│  Output: Training curriculum (JSON)                          │
│    - 500 scenario outlines per domain                        │
│    - Diagnostic decision trees                               │
│    - Edge case specifications                                │
│    - Expected DPEV loop patterns                             │
│                                                              │
│  This is user-generated content with tool assistance (legal) │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 2: Data Generation (Llama 3.1 405B on RunPod)        │
│                                                              │
│  Input: Curriculum + domain docs                             │
│  Output: JSONL training data                                 │
│    - system/user/assistant turns in DPEV format              │
│    - 5,000+ scenarios per domain                             │
│    - Diverse error patterns, edge cases                      │
│                                                              │
│  Clean provenance: Llama Community License                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 2.5: Quality Filtering                                │
│                                                              │
│  - Deduplication (MinHash + exact match)                     │
│  - Consistency check (does answer match scenario?)           │
│  - DPEV format validation (all 4 phases present?)            │
│  - Difficulty scoring (easy/medium/hard distribution)         │
│                                                              │
│  Target: 80%+ pass rate. Below 60% = curriculum needs fixing │
└─────────────────────────────────────────────────────────────┘
```

**Estimated cost per domain Expert Pack:**

| Component | Cost | Time |
|-----------|------|------|
| Claude curriculum design | ~$5-15 (API tokens) | 1-2 hours |
| Llama 405B data generation (RunPod 2xH200) | ~$40-80 (5-10 hrs @ $7.98/hr) | 5-10 hours |
| Quality filtering | Negligible (local compute) | 1-2 hours |
| **Total per domain** | **~$50-100** | **~8-15 hours** |

### Step 3: QLoRA Fine-Tuning ("The Furnace")

**Status: PROVEN -- Unsloth is the clear winner**

**Unsloth (2026 state):**
- 2-3x faster than HuggingFace + PEFT, 70% less VRAM
- Custom Triton kernels for RoPE, MLP, attention
- Supports Qwen, Llama, Mistral, DeepSeek architectures
- QLoRA on 32B model: fits on single A100 80GB
- QLoRA on 70B model: requires A100 80GB (tight) or 2x A40 with FSDP
- New 2026 features: 89K context for Llama 3.3 70B on 80GB GPU, 3x faster with padding-free + packing

**Framework comparison (validated 2026):**

| Framework | Speed | VRAM Efficiency | Maturity | Recommendation |
|-----------|-------|-----------------|----------|----------------|
| **Unsloth** | Fastest (2-3x) | Best (70% less) | Production-ready | USE THIS |
| Axolotl | 1x baseline | Standard | Production-ready | Fallback if Unsloth breaks |
| TorchTune (Meta) | ~1x | Standard | Growing | Watch, don't adopt yet |
| HF Transformers + PEFT | 1x | Baseline | Mature | Only if needing exotic models |

**Hardware requirements per model size:**

| Base Model | GPU Required | Training Time (10K samples) | LoRA Output Size (r=16) |
|------------|-------------|---------------------------|------------------------|
| Qwen 2.5 Coder 7B | RTX 4090 24GB | ~1-2 hours | ~30 MB |
| Qwen 2.5 Coder 32B | A100 80GB | ~3-5 hours | ~60 MB |
| Llama 3.3 70B | A100 80GB (tight) or 2xA40 | ~6-10 hours | ~120 MB |

**Training configuration (recommended defaults):**

```python
# Unsloth QLoRA config for InfraBrain Expert Pack
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen2.5-Coder-32B-bnb-4bit",
    max_seq_length=4096,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=16,                    # Rank 16 = good quality/size tradeoff
    lora_alpha=16,           # alpha = r is standard
    target_modules=[         # All linear layers
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_dropout=0,          # Unsloth optimized, no dropout
    bias="none",
)
```

### Step 4: Runtime Hot-Swapping ("The Delivery")

**Status: PROVEN -- vLLM multi-LoRA is production-ready**

**vLLM LoRA Serving (current state, v0.8.x):**

| Capability | Status | Details |
|------------|--------|---------|
| Static LoRA loading at startup | STABLE | `--lora-modules name1=path1 name2=path2` |
| Per-request adapter selection | STABLE | `model` field in OpenAI API selects adapter |
| Dynamic loading/unloading at runtime | AVAILABLE (with flag) | `VLLM_ALLOW_RUNTIME_LORA_UPDATING=True` enables `/v1/load_lora_adapter` and `/v1/unload_lora_adapter` |
| In-place adapter replacement | AVAILABLE | `load_inplace=True` replaces existing adapter weights |
| LoRA Resolver Plugin | AVAILABLE | Auto-loads adapters on first request for unknown model name |
| S-LoRA (2000 concurrent adapters) | RESEARCH | Demonstrated on single A100, integrated into vLLM codebase |

**Performance characteristics:**

| Metric | Value | Source | Confidence |
|--------|-------|--------|------------|
| Adapter selection (already loaded) | **~0 ms overhead** | Per-request routing, no swap needed | HIGH |
| Adapter swap (CPU→GPU, LRU cache) | **Sub-second** | Adapter weights are small (60-240MB) | MEDIUM |
| Throughput penalty vs base model | **10-50% at high load** | Reported on A100 40GB with Llama-2-7B. Becomes compute-bound at high request rates | HIGH |
| Max concurrent adapters (S-LoRA) | **2,000 on single A100** | LMSYS benchmark | HIGH |
| Max concurrent adapters (standard vLLM) | **Dozens** | Limited by `max_loras` and `max_cpu_loras` config | HIGH |

**Critical nuance:** The "negligible switch time" in vLLM documentation refers to per-request adapter selection when adapters are already in GPU memory. When an adapter must be swapped from CPU cache to GPU (LRU eviction), latency increases but remains sub-second for typical LoRA sizes. This is acceptable for InfraBrain's use case (not a real-time chat service, but a diagnostic tool).

**Security warning from vLLM docs:** Dynamic LoRA loading (`VLLM_ALLOW_RUNTIME_LORA_UPDATING=True`) "comes with security risks and should not be used in production unless it is an isolated, fully trusted environment." For InfraBrain's air-gapped deployment, this is acceptable -- the engine and vLLM run on the same trusted server. Do NOT expose the vLLM API externally.

**Integration with InfraBrain:**

```typescript
// src/providers/vllm-lora.ts
// When a skill requires a LoRA adapter, the provider selects it via the model field

async function completeWithLoRA(
  prompt: string,
  baseModel: string,   // "qwen2.5-coder:32b"
  loraAdapter: string  // "sap-hana-expert"
): Promise<string> {
  const response = await fetch('http://localhost:8000/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: loraAdapter,  // vLLM routes to correct adapter
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  return response.json();
}
```

---

## Proven vs Aspirational Assessment

| Component | Status | Rationale |
|-----------|--------|-----------|
| OCI artifact distribution (ORAS + Zot/Harbor) | **PROVEN** | CNCF ecosystem, millions of production deployments |
| Nmap network discovery | **PROVEN** | 25+ year track record, industry standard |
| Docker API discovery (dockerode) | **PROVEN** | Mirrors Docker daemon API directly |
| Kubernetes API discovery (@kubernetes/client-node) | **PROVEN** | Official client, maintained by K8s SIG |
| AD/LDAP discovery (ldapts) | **VALIDATED** | Active library, but ldapjs ecosystem is fragmented post-decommission. Test thoroughly with real AD environments |
| Qdrant air-gapped deployment | **PROVEN** | Single binary, pre-built releases, no dependencies |
| Qdrant at enterprise scale (1M+ vectors) | **PROVEN** | Production deployments documented, scalar quantization works |
| vLLM static multi-LoRA serving | **PROVEN** | Documented, benchmarked, production-ready |
| vLLM dynamic LoRA loading/unloading | **VALIDATED** | Works but marked with security warnings. Needs env flag |
| Unsloth QLoRA training | **PROVEN** | NVIDIA-endorsed, AWS SageMaker integration, massive adoption |
| Two-stage synthetic data pipeline | **VALIDATED** | Pattern proven (InstructLab, Nemotron), but InfraBrain-specific quality requires iteration |
| Auto-provisioning (tech detection → pack matching) | **ASPIRATIONAL** | The mapping table needs real-world data. Nmap service detection is imperfect. Expect false positives/negatives |
| Self-learning skill generation | **ASPIRATIONAL** | Generating valid Markdown skills from admin corrections is ambitious. LLM output quality varies |
| Artifact signing with Cosign for LoRA supply chain | **VALIDATED** | Cosign is proven, but applying it to LoRA artifacts is novel usage |
| Full Day 0 wizard end-to-end | **ASPIRATIONAL** | Individual pieces proven, but the orchestrated flow across 4+ agent types on diverse enterprise networks is untested |

---

## Security Summary

| Pillar | Primary Risk | Mitigation |
|--------|-------------|------------|
| Registry / Distribution | Supply-chain attack (malicious LoRA) | Cosign signing + verification before loading |
| Day 0 Discovery | Credential exposure (AD bind, kubeconfig) | OS keychain storage, never plaintext |
| Day 0 Discovery | IDS alerts from Nmap scanning | Default to `-T3`, document for SOC teams |
| Auto-Provisioning | Wrong packs for detected tech | HITL approval gate, human reviews plan |
| Knowledge Base | Data sovereignty violation | 100% local, filesystem encryption, purge command |
| LoRA Hot-Swap | Adversarial adapter injection | Signature verification, no external API exposure |
| vLLM Dynamic Loading | Unauthorized adapter loading | Bind to localhost, environment flag required |

---

## Implications for Roadmap

### Suggested Phase Structure for Day 0 + Ecosystem

**Phase A: Registry & Distribution Infrastructure** (Foundation -- build first)
- Set up Zot/Harbor registry
- Implement ORAS client wrapper
- Define artifact schemas (LoRA Pack, Skill Pack manifests)
- Cosign signing pipeline
- Rationale: Everything else depends on being able to distribute artifacts

**Phase B: Day 0 Discovery Agents** (Can parallelize with Phase A)
- Network scanner (Nmap wrapper)
- Docker/K8s inspectors
- AD/LDAP crawler
- Topology model + SQLite storage
- Rationale: Independent of registry, but needed before auto-provisioning

**Phase C: Auto-Provisioning** (Requires A + B)
- Tech-to-pack matching engine
- Provisioning planner with HITL gate
- ORAS pull + verify + place
- `/infra:setup` CLI command orchestration
- Rationale: Glue layer, relatively thin once A + B exist

**Phase D: LoRA Production Pipeline** (Can start anytime, independent)
- Curriculum design tooling (Stage 1)
- Synthetic data generation scripts (Stage 2)
- Unsloth training harness (Stage 3)
- Quality filtering pipeline (Stage 2.5)
- First Expert Pack (e.g., nginx-expert) as proof of concept
- Rationale: Long lead time (weeks per domain), start early

**Phase E: vLLM Integration + Hot-Swap** (Requires D for test adapters)
- vLLM provider implementation (`src/providers/vllm.ts`)
- Multi-LoRA serving configuration
- Dynamic loading integration
- Performance benchmarking on target hardware
- Rationale: Need actual LoRA adapters to test with

### Phase ordering rationale
- A and B are independent foundations, can be built in parallel
- C is thin glue, quick once A+B complete
- D has the longest lead time (training pipeline setup + first domain pack)
- E is the final integration that proves the architecture works end-to-end

### Research flags for phases
- Phase B (Discovery): NEEDS DEEPER RESEARCH on enterprise network diversity (VLANs, firewalls blocking discovery, SNMP v3 auth complexity)
- Phase D (LoRA Pipeline): NEEDS ITERATION on quality metrics. First domain pack will reveal whether 5,000 scenarios is sufficient or needs 10,000+
- Phase E (vLLM): NEEDS BENCHMARKING on target hardware (RTX 5090) with actual InfraBrain workload patterns

---

## Open Questions

1. **SNMP Discovery:** Enterprise switches/routers often require SNMPv3 with auth. How deep should network equipment discovery go in Day 0? Recommend: defer deep network equipment discovery to Phase B+1, focus on server/container discovery first.

2. **Multi-tenant Registry:** If InfraBrain serves multiple customers from one lab, how are customer-specific LoRAs isolated in Harbor? Answer: Harbor projects with per-customer RBAC. But this needs design work.

3. **LoRA Quality Benchmarking:** How do we measure that a domain Expert Pack actually improves diagnostic accuracy? Need a benchmark suite per domain (e.g., 100 SAP HANA scenarios with known-correct diagnoses). This is validation infrastructure that must be built alongside the training pipeline.

4. **Nmap as System Dependency:** The standalone binary can't bundle Nmap (it's GPL). Options: (a) document as prerequisite, (b) use pure-JS port scanner for basic discovery + Nmap for deep scan if available, (c) bundle Nmap separately. Recommend: document as prerequisite, provide a degraded pure-JS fallback for basic host discovery.

5. **ldapts Longevity:** With ldapjs decommissioned, the LDAP ecosystem in Node.js is fragile. ldapts has 148K weekly downloads but unclear long-term governance. Mitigation: abstract behind an interface so the LDAP client can be swapped. If the Node.js LDAP ecosystem collapses, consider shelling out to `ldapsearch` CLI (available on all Linux systems).

---

## Sources

### OCI & Distribution
- [OCI Artifacts Explained (2025)](https://oneuptime.com/blog/post/2025-12-08-oci-artifacts-explained/view)
- [ORAS v1.3.0 Announcement (CNCF, Oct 2025)](https://www.cncf.io/blog/2025/10/06/announcing-oras-v1-3-0-elevating-artifact-and-registry-management-workflows/)
- [ORAS Quick Start](https://oras.land/docs/quickstart/)
- [KAITO: Model as OCI Artifacts](https://kaito-project.github.io/kaito/docs/next/model-as-oci-artifacts/)
- [Zot Registry (GitHub)](https://github.com/project-zot/zot)
- [Harbor Satellite for Air-Gapped](https://github.com/container-registry/harbor-satellite)
- [Harbor Registry Overview](https://www.openlogic.com/blog/harbor-registry-overview)

### vLLM & LoRA Serving
- [vLLM LoRA Adapters Docs (v0.8.1)](https://docs.vllm.ai/en/v0.8.1/features/lora.html)
- [vLLM LoRA Performance Issue #10062](https://github.com/vllm-project/vllm/issues/10062)
- [S-LoRA: Serving Thousands of Concurrent LoRA Adapters (LMSYS)](https://lmsys.org/blog/2023-11-15-slora/)
- [vLLM Dynamic LoRA Loading RFC #6275](https://github.com/vllm-project/vllm/issues/6275)
- [Multi-LoRA Benchmarking (UKSystems 2025)](https://uksystems.org/workshop/2025/pdfs/paper24.pdf)
- [Inferless: Multi-LoRA Deployment Guide](https://www.inferless.com/learn/how-to-serve-multi-lora-adapters)
- [Ollama vs vLLM Performance Benchmark 2026 (SitePoint)](https://www.sitepoint.com/ollama-vs-vllm-performance-benchmark-2026/)

### Training Pipeline
- [Unsloth GitHub (2026)](https://github.com/unslothai/unsloth)
- [NVIDIA: Fine-Tune LLMs on RTX GPUs With Unsloth](https://blogs.nvidia.com/blog/rtx-ai-garage-fine-tuning-unsloth-dgx-spark/)
- [Unsloth Qwen3 Fine-Tuning Docs](https://unsloth.ai/docs/models/qwen3-how-to-run-and-fine-tune)
- [MarkTechPost: QLoRA Pipeline with Unsloth (Mar 2026)](https://www.marktechpost.com/2026/03/03/how-to-build-a-stable-and-efficient-qlora-fine-tuning-pipeline-using-unsloth-for-large-language-models/)
- [Axolotl vs Unsloth vs TorchTune Comparison (2026)](https://www.spheron.network/blog/axolotl-vs-unsloth-vs-torchtune/)

### Synthetic Data
- [InstructLab: Synthetic Data for LLM Fine-Tuning (InfoQ, 2025)](https://www.infoq.com/news/2025/03/llm-finetuning-synthetic-data/)
- [Red Hat: InstructLab Synthetic Data Generation](https://www.redhat.com/en/blog/how-instructlabs-synthetic-data-generation-enhances-llms)
- [NVIDIA Nemotron-4 Synthetic Data Pipeline](https://blogs.nvidia.com/blog/nemotron-4-synthetic-data-generation-llm-training/)
- [Stratos: End-to-End Distillation Pipeline (2025)](https://arxiv.org/html/2510.15992v1)

### Discovery Tools
- [node-nmap (npm)](https://www.npmjs.com/package/node-nmap)
- [ldapts (npm)](https://www.npmjs.com/package/ldapts)
- [dockerode (npm)](https://www.npmjs.com/package/dockerode)
- [@kubernetes/client-node (npm)](https://www.npmjs.com/package/@kubernetes/client-node)
- [Kubernetes Client Libraries (official)](https://kubernetes.io/docs/reference/using-api/client-libraries/)

### Vector DB
- [Qdrant Installation Guide](https://qdrant.tech/documentation/guides/installation/)
- [Qdrant Edge](https://qdrant.tech/edge/)
- [Qdrant 2025 Recap](https://qdrant.tech/blog/2025-recap/)
- [Qdrant Binary Releases (GitHub)](https://github.com/qdrant/qdrant/releases)
- [Air-Gapped AI Solutions (2026)](https://blog.premai.io/air-gapped-ai-solutions-7-platforms-for-disconnected-enterprise-deployment-2026/)
