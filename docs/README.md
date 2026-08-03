---
tags:
  - Entity group
  - Docs directory
updated: 2026-07-13
---

# 📁 docs · Entity Group Documentation Directory

Informational documents for the entity group (research / plans / workflows / design / progress) belong in this directory. Engineering code lives in other repository directories (`api/` `web/` `agent/` `core/` `entity-prescan/`, etc.) and is not placed here.

The entity group is also responsible for the production of digital assets and images such as characters, scenes, and props. Cross-group asset schemas, visual-setting rules, generation flows, and quality standards go in `docs/`; specific runtime artifacts and images stay in the formal run archive and are not dumped directly into the documentation directory.

## 📂 Current Structure

This repository's docs have historically been kept **flat**; the current categories are:

| File / Directory | Category |
| --- | --- |
| `extraction-progress-research-report.md`, `web-frontend-research-report.md` | Research |
| `ENTITY_PRESCAN_FLOW.md`, `pipeline-flowchart.md`, `pipeline-flowchart.html` | Workflow / Flow |
| `entity-function-modules.canvas` | Workflow |
| `PROJECT_STATUS.md` | Progress |
| `web-story-arcs-frontend-design.md`, `web-extraction-artifacts-frontend.md` | Design |
| `superpowers/plans/` | Phase plans |
| `superpowers/specs/` | Design |

## 📂 Reserved Subdirectories (new content goes here)

To align with the unified four-repository convention, new documents are recommended to be filed into the following subdirectories (empty directories already created):

| Subdirectory | Content | Category tag |
| --- | --- | --- |
| `research/` | Tool / technology / solution research reports | `Research` |
| `plans/` | Implementation plans, weekly plans, milestones | `Phase plans` |
| `workflows/` | Flowcharts, Obsidian Canvas, flowchart | `Workflow` |
| `specs/` | Technical design specs, data contracts | `Design` |

> ⚠️ **Existing flat files are not relocated**: files such as `ENTITY_PRESCAN_FLOW.md` have relative-path cross-references between them, and forcing them into subdirectories would break those references. Just file new documents into the subdirectories.

> This directory is the single source of truth for entity-group engineering documentation and is no longer copied wholesale to the coordination repository. Only research and progress are archived on demand by the information-retention group. Documentation conventions are in [文档规范.md](文档规范.md).

## 🔗 Downstream Delivery

- The story group references entity IDs, evidence snippets, and narrative events.
- The video group references asset IDs, visual settings, images, prompts, and versions for characters, scenes, and props.
- Delivery notes must specify the source path or commit to avoid replicating a second authoritative asset set in downstream repositories.
