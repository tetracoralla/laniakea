---
name: organize-mind-maps
description: Create, inspect, search, or safely revise a durable Laniakea Markdown mind map. Use when the user explicitly asks for a mind map or hierarchical outline artifact, names Laniakea, provides a Laniakea .md file, or wants an existing map reorganized for continued human and Agent collaboration.
---

# Organize Mind Maps

Use Laniakea for a durable artifact the user can open and edit, not as private scratch space for ordinary reasoning.

## Make the hierarchy understandable

- Before expanding details, identify the stable mental picture, primary
  relationship, or user-perceived objects that should remain understandable
  when deeper branches are collapsed. Do not start from a flat fact or
  capability inventory merely because it is easy to enumerate.
- Let a parent name the relationship shared by its children. Give independently
  understandable, selectable, or discussable peers separate sibling nodes
  instead of compressing them into one colon-led or delimiter-separated leaf.
- Keep one complete relationship as one cognitive unit. An authentication
  method, gesture sequence, transaction, or object mapping does not need to be
  split merely because its label contains several actions or values.
- Use the shallowest levels for the core model and progressively disclose local
  actions, states, exceptions, and recovery below the object or carrier that
  owns them. A collapsed map should still answer what the subject is, what its
  main parts or relationships are, and where a reader should expand next.
- Preserve the difference between current structure, a proposal, and an
  unresolved question. Do not promote plausible future ideas into current
  branches, and do not add filler or fuse nodes to reach a preferred depth or
  node count.

## Choose the action

- Call `create_mind_map` only when the user wants a new file and has supplied or approved an absolute destination path. It never overwrites an existing file.
- Call `read_mind_map` before changing an existing map. Use its `revision` and node `ref` values only for that version.
- Call `search_mind_map` to locate a branch in a large map instead of loading unrelated content.
- Call `update_mind_map` once with a coherent batch of semantic operations. Use `dryRun` when the requested restructuring is ambiguous or consequential.

## Protect the shared document

- Never invent a file path, silently choose a document, scan a folder, or replace an existing file during creation.
- If a read returns `canUpdate: false`, preserve the rich Markdown source. Create a new Laniakea outline only when the user asks for that conversion.
- If an update reports a revision conflict, do not retry with the stale revision. Read again, reconcile the requested change with the new structure, and submit a fresh batch.
- Treat deletion and moving as visible structural changes. Keep the final response focused on what changed, not internal refs or payloads.
- Do not claim the map is saved unless `create_mind_map` succeeded or `update_mind_map` returned `wrote: true`.

Use ordinary prose when the user only wants an answer or a temporary hierarchy and did not ask for a persistent mind-map artifact.
