# DeepTutor — Agent-Native Architecture

## Overview

DeepTutor is an **agent-native** intelligent learning companion organized
around a two-layer plugin model — single-shot **Tools** invoked by the
LLM, and multi-stage **Capabilities** that take over a turn — exposed
through three entry points: CLI, WebSocket API, and Python SDK.

## Architecture

```
Entry Points:  CLI (Typer)  |  WebSocket /api/v1/ws  |  Python SDK
                    ↓                   ↓                   ↓
              ┌─────────────────────────────────────────────────┐
              │              ChatOrchestrator                    │
              │   routes UnifiedContext → selected Capability    │
              │   (defaults to `chat`)                           │
              └──────────┬──────────────┬───────────────────────┘
                         │              │
              ┌──────────▼──┐  ┌────────▼──────────┐
              │ ToolRegistry │  │ CapabilityRegistry │
              │  (Level 1)   │  │   (Level 2)        │
              └──────────────┘  └────────────────────┘
```

All capabilities emit on a shared `StreamBus`; the orchestrator fans
events out to consumers. Runtime settings live in
`data/user/settings/*.json` — project-root `.env` files are intentionally
ignored.

### Level 1 — Tools

Single-function tools the LLM picks on demand. Four user-toggleable tools
surface in `/settings/tools`:

| Tool           | Description                                   |
| -------------- | --------------------------------------------- |
| `brainstorm`   | Breadth-first idea exploration with rationale |
| `web_search`   | Web search with citations                     |
| `paper_search` | arXiv preprint search                         |
| `reason`       | Dedicated deep-reasoning LLM call             |

The rest are **context-gated**: the chat capability auto-mounts them from
`ToolMountFlags` (presence of a KB, attachments, sandbox availability, …), and
any of them can also be force-enabled via `--tool`. Auto-mounted set: `rag`,
`read_source`, `read_memory`, `write_memory`, `read_skill`, `load_tools`,
`exec`, `code_execution` (sandboxed Python: NL intent → code → run),
`list_notebook`, `write_note`, `web_fetch`, `github`, `cron`,
`ask_user` (pauses the turn and resumes with the user's reply), plus the
mastery-path tools. `geogebra_analysis` is parked under
`COMING_SOON_TOOL_TYPES`.

### Level 2 — Capabilities

Multi-stage pipelines that own the turn:

| Capability       | Stages                                                |
| ---------------- | ----------------------------------------------------- |
| `chat`           | exploring → responding (single agentic loop, default) |
| `mastery_path`   | responding (Guided Learning — chat loop + mastery tools, gated per topic type) |
| `deep_solve`     | planning → reasoning → writing                        |
| `deep_question`  | ideation → generation                                 |
| `deep_research`  | rephrasing → decomposing → researching → reporting    |
| `visualize`      | analyzing → generating → reviewing (SVG / Chart.js / Mermaid / HTML; or routes to Manim sub-stages via `render_type`) |
| `math_animator`  | concept_analysis → concept_design → code_generation → code_retry → summary → render_output |

All capabilities converge on `emit_capability_result()` in
`deeptutor/capabilities/_shared.py` so every turn emits the same envelope
(response payload + `cost_summary` from `UsageTracker`). Status copy and
prompts are i18n'd via `capabilities/prompts/{en,zh}/<name>.yaml`.

## CLI Usage

```bash
# Install
pip install deeptutor      # Full app (CLI + Web/API + packaged Web assets)
pip install deeptutor-cli  # CLI-only

# Run any capability
deeptutor run chat "Explain Fourier transform"
deeptutor run deep_solve "Solve x^2=4" -t rag --kb my-kb
deeptutor run visualize "Animate sine wave" --config render_mode=manim_video

# Interactive REPL
deeptutor chat
# (inside the REPL: /regenerate or /retry re-runs the last user message)

# Partners (IM-connected companions)
deeptutor partner list

# Knowledge bases, memory, server
deeptutor kb list
deeptutor kb create my-kb --doc textbook.pdf
deeptutor memory show
deeptutor serve --port 8001       # API server only
deeptutor start                   # backend + frontend together
```

## Key Files

| Path                                       | Purpose                              |
| ------------------------------------------ | ------------------------------------ |
| `deeptutor/runtime/orchestrator.py`        | `ChatOrchestrator` — unified entry   |
| `deeptutor/runtime/launcher.py`            | Backend + frontend lifecycle / port discovery |
| `deeptutor/runtime/registry/`              | Tool + Capability registries         |
| `deeptutor/runtime/bootstrap/builtin_capabilities.py` | Built-in capability class paths |
| `deeptutor/services/config/runtime_settings.py` | JSON settings + process-env overrides |
| `deeptutor/core/stream.py`, `stream_bus.py` | StreamEvent protocol + async fan-out |
| `deeptutor/core/tool_protocol.py`          | `BaseTool` + `ToolDefinition`         |
| `deeptutor/core/capability_protocol.py`    | `BaseCapability` + `CapabilityManifest` |
| `deeptutor/core/context.py`                | `UnifiedContext` dataclass            |
| `deeptutor/tools/builtin/__init__.py`      | All built-in tool wrappers           |
| `deeptutor/capabilities/`                  | Built-in capability implementations  |
| `deeptutor/app.py`                         | `DeepTutorApp` — Python SDK facade    |
| `deeptutor_cli/main.py`                    | Typer CLI entry point                |
| `deeptutor/api/routers/unified_ws.py`      | Unified WebSocket endpoint           |

## Dependency Layers

Public install paths and source extras are defined in `pyproject.toml`.
Requirements files mirror the same dependency groups for Docker/CI installs.

```
pip install deeptutor      — Full app (CLI + Web/API + packaged Web assets)
pip install deeptutor-cli  — CLI-only (LLM + RAG + providers + document parsing)
pip install -e .           — Source install for development

Source extras (.[ extra ], defined in pyproject.toml):
.[cli]            — CLI-only dependency set
.[server]         — Web/API server dependencies
.[partners]       — Partner channel SDKs + MCP client  (legacy alias: .[tutorbot])
.[matrix]         — Matrix channel for Partners (matrix-nio; needs libolm)
.[matrix-e2e]     — Matrix with end-to-end encryption (matrix-nio[e2e])
.[math-animator]  — Manim addon (powers `visualize` Manim renders + `deeptutor run math_animator`)
.[dev]            — Test / lint tooling
.[all]            — Everything above
```

## Niannian Learning Project Rules

This checkout is the canonical local workspace for the Niannian learning
product. Work from this directory for future changes; the former mixed
workspace under `E:/codex/aisp/aidaihuo/github-selected-projects/deeptutor`
is a read-only rollback copy unless the user explicitly says otherwise.

- Local-first: verify changes against the local WSL/Docker instance before
  considering any online deployment. Do not publish to the production site
  without an explicit user request.
- Direct-release exception: when the user explicitly requests immediate
  server publishing, do not block on local page/container acceptance. Run
  lightweight local static checks when available, deploy through the saved
  server route, and perform the real route and health acceptance on the server
  after traffic is switched.
- Execution default: run local tests, read-only diagnostics, build checks, and
  other reversible verification steps without asking the user for per-step
  permission. Report only the result and practical value. Ask before actions
  that create meaningful external side effects, such as production publishing,
  paid-provider calls, credential use, or changes to real user data.
- Highest-value action and Skill routing: before each new implementation or
  verification push, identify the single highest-value smallest executable
  action, state it to the user, and route it through the narrowest applicable
  local Skill or a relevant GitHub source when that materially improves the
  result. State the selected route before execution, then continue without a
  second confirmation for ordinary tests and diagnostics.
- Professional iterative GitHub delivery: default code work to a short-lived
  `codex/<scope>` branch after inspecting the current branch, worktree, remote,
  and overlapping user changes. Deliver one bounded behavior at a time through
  small reviewable commits, focused automated checks, and real-path evidence;
  never include unrelated dirty files. When a project-owned writable GitHub
  remote and authentication are available, push the branch and open or update
  a Pull Request as the normal handoff; never treat an upstream-only remote as
  the project's delivery target. The PR must state the user outcome, changed
  surface, verification evidence, screenshots for UI work, known risk, and a
  practical rollback. If GitHub access is unavailable, finish the local
  implementation and report the exact blocked push or PR step instead of
  claiming delivery. Do not force-push, merge a PR, publish production, or
  modify real user data unless the user explicitly authorizes that action.
- Exact-commit PR acceptance: observed trigger: a PR passed static checks while
  its screenshots came from another working tree, so production readiness could
  not be proven. Protected action: recommending, merging, or deploying a PR.
  Owner: the current production agent. The gate exits only when the exact PR
  HEAD has proportionate automated checks, an accessible preview or isolated
  candidate built from that same commit, the changed real user path has been
  exercised on desktop and 390px when UI is affected, and the handoff states
  the user outcome, known risk, and practical rollback. Give the user the link
  plus one to three concrete actions and expected visible results; the user
  judges the experience while the agent owns the technical evidence. A user
  response such as `验收通过，发布` authorizes merge and deployment only for
  that accepted HEAD; any later commit invalidates the acceptance and requires
  refreshed evidence. If the user explicitly invokes the direct-release
  exception, deploy the exact release candidate and perform the equivalent
  real-path acceptance after traffic is switched.
- Student-first product boundary: the current product is a general-purpose AI
  Agent centered on conversation with Nian Nian, photo questions, voice input,
  files, tools, and capabilities. Keep admin/provider/model configuration out
  of the student navigation. Student routes reuse the single primary
  workspace sidebar; do not render a separate `STUDENT_NAV` or a second
  student-specific sidebar.
- Curriculum boundary: curriculum packages are not part of the current main
  product, main navigation, or Agent positioning. Future subject/course areas
  may be added as independent sections with their own explicit scope; do not
  add course IDs, preset packs, diagnostic funnels, or course claims to the
  general Agent experience.
- Ready-to-use productization is the current primary product direction. Turn
  the existing Agent, Partner, knowledge, photo, voice, file, tool, and
  capability primitives into administrator-authored learning templates that a
  student or parent can start with one choice or one tap. Do not require them
  to understand models, providers, prompts, Personas, Souls, knowledge-base
  construction, tool mounting, or Agent configuration.
- A learning template is an orchestration preset, not a curriculum package or
  a new navigation system. It may bind region, school stage, grade, subject,
  textbook edition, verified learning materials, a prepared Nian Nian role,
  default tools, starter actions, and age-appropriate answer policy. Reuse the
  existing single workspace, chat, Partner, Persona, grant, and knowledge-base
  contracts instead of building parallel template-specific engines.
- Build template coverage in thin vertical slices. Start with junior-high
  mathematics and the People's Education Press edition, make one real
  student flow work end to end, then expand grades, regions, editions,
  supplementary materials, papers, and verified past exams. Do not claim
  content or regional coverage until the corresponding assets, provenance,
  rights, retrieval, and student path have been verified.
- Keep content catalog metadata separate from content rights and binaries.
  Every textbook, supplementary book, paper, and past-exam source must record
  provenance, edition/year/region, ownership or license status, revision, and
  availability. Never scrape, bundle, publish, or expose copyrighted full text
  without authorization; prefer licensed, public-domain, administrator-owned,
  or user-uploaded material.
- Optimize first-run value: ask no more than the minimum profile facts needed
  to recommend a starting template, provide a safe default when facts are
  missing, and let the student begin with photo, voice, or text immediately.
  Progressive customization belongs after the first successful learning turn.
- Design every student or parent page from the user's immediate intent before
  exposing backend capability. For each route, define the user's primary
  question, the most valuable first-viewport result, one primary action, the
  visible result of that action, and the required loading, empty, permission,
  error, and return states. Do not implement a page whose purpose can only be
  explained with internal product terms or instructional copy.
- The frontend specification is part of feature completeness. Before building
  a new backend primitive or template catalog, describe what the route looks
  like on desktop and 390px mobile, what the user can do without configuration,
  and what remains progressively disclosed. Prefer a directly usable prepared
  object over a creation wizard, settings form, or generic management table on
  student-facing routes.
- Every primary student or parent route must provide a route-specific bilingual
  introduction through the shared page-intro component. Show it automatically
  on the first visit to that route version, remember dismissal, and keep a
  consistent help control that reopens it. Keep the modal concise: page purpose,
  the few actions users can take now, and one continue action.
- Maintain Simplified Chinese and English as an explicit UI mode with Chinese
  as the default. Keep the language switch reachable from the shared shell,
  persist the user's choice, and localize each page deliberately, including
  navigation, dialogs, empty/loading/error/permission states, generated default
  names, and backend-provided labels. A translation key that falls back to its
  English source is not accepted as Chinese localization.
- Template acceptance is a real learning outcome, not successful preset
  creation. Verify on desktop and 390px mobile that a fresh student can select
  or receive a template, start a task in one tap, have the prepared teacher use
  the bound conversation and learning material correctly, and continue without
  seeing generic workspace configuration. Keep the detailed rollout plan in
  `NIANNIAN_READY_TO_USE_PLAN.md`.
- Default to Chinese visible UI and concise action-oriented copy. Avoid
  explanatory small print unless it is required for a user decision or an
  error state.
- Preserve the approved desktop and 390px mobile layout. After UI changes,
  check the real page for overflow, overlap, blocked text, and touch/voice/
  photo interaction.
- Keep credentials and runtime user data out of source changes and reports.
  The excluded `data/` directory is runtime state and must be configured
  separately for a local instance.
- Server-first heavy-work rule: when local memory is insufficient for a
  build or end-to-end verification, use the saved SSH alias
  `haika-kidswear-1757` directly instead of repeatedly asking for connection
  details. Sync only source and build inputs; always exclude `data/`, secrets,
  real runtime data, `.venv/`, `web/node_modules/`, `web/.next/`, and caches.
  Replace only the DeepTutor application and sandbox runner containers, keep
  PocketBase/Caddy and data mounts unchanged, and retain a rollback image or
  source baseline before switching traffic.
