# Temporary File Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the existing Windows/Linux file drop surface into a reliable session-only shelf for dropped images, PDFs, code, and documents, with an Ask Pip flow.

**Architecture:** Keep native file copying in the existing Rust `files::ingest` command and keep session shelf metadata in the existing TypeScript `State`. Extend the existing `+` upload surface into a small shelf view rather than adding a window or persistence layer. Reuse the existing `ChatContext` path for one selected attachment and keep shelf entries after chat consumes the attachment.

**Tech Stack:** Tauri 2, Rust, TypeScript, Vite, existing DOM helpers and state/view architecture.

**Spec:** `docs/superpowers/specs/2026-10-15-temporary-file-shelf-design.md`

## Global Constraints

- Shelf state is session-only; do not add cloud sync, a database, or permanent document management.
- Native ingestion copies user files into the existing inbox and preserves filename collision behavior.
- Only one selected attachment is sent through the existing `ChatContext` contract.
- Folders are rejected with a clear error; failed copies are never presented as usable attachments.
- Existing app styling, agent UI, stable IDs, and unrelated dirty work remain unchanged.
- Tauri v2 drag/drop uses file paths on `enter`/`drop`; Windows uses `app.windows.dragDropEnabled`.

## Review Focus

- A Tauri drop event with no paths or a folder path must not enter an upload state — test in Task 1.
- Two files with the same name must create distinct shelf entries and copied inbox files — test in Task 1.
- A missing shelf path must disable Ask Pip without deleting unrelated entries — test in Task 2.
- Removing/clearing shelf items must not delete or alter the selected chat context accidentally — test in Task 2.
- Shelf controls must remain inside the fixed island at compact and expanded heights — test in Task 3.

---

### Task 1: Harden native file ingestion and drop event handling

**Files:**
- Modify: `windows/src-tauri/src/files.rs`
- Modify: `windows/src-tauri/src/lib.rs`
- Modify: `windows/src-tauri/src/platform/windows.rs`
- Modify: `windows/src-tauri/tauri.conf.json`
- Modify: `windows/src/core/bridge.ts`
- Modify: `windows/src/island/island.ts`
- Test: existing Rust file tests in `windows/src-tauri/src/files.rs` or the nearest existing test module

**Interfaces:**
- Consumes: existing `ingest_file(path: String) -> Result<DroppedFile, String>` and `DragDropPayload`.
- Produces: deterministic rejection for folders/empty paths, a safe copied `DroppedFile`, and one ingestion attempt per dropped path.

- [ ] **Step 1: Write failing Rust tests** for folder rejection, missing path rejection, duplicate filename copying, and metadata returned for a regular file.
- [ ] **Step 2: Run the focused Rust tests** with `cargo test --manifest-path windows/src-tauri/Cargo.toml files` and confirm the new cases fail for the current behavior.
- [ ] **Step 3: Implement the smallest native validation fix** in `files::ingest`; preserve the existing inbox location and collision suffix behavior.
- [ ] **Step 4: Verify the Rust tests pass** and confirm returned paths point inside the existing inbox.
- [ ] **Step 5: Update the drop bridge and island handler** so `drop` with multiple paths ingests each file, ignores duplicate event transitions, resets `fileDragOver`, and reports the first failure without silently discarding successful entries.
- [ ] **Step 6: Verify Tauri configuration and Windows handoff** use `app.windows.dragDropEnabled` and the existing `unblock_webview_drops` path; do not add an HTML5 drop implementation that competes with Tauri.

### Task 2: Add session shelf state and chat attachment contract

**Files:**
- Modify: `windows/src/core/state.ts`
- Modify: `windows/src/views/chat.ts`
- Modify: `windows/src/views/upload.ts`
- Modify: `windows/src/views/views.ts` only where the new shelf view must be registered
- Test: `windows/scripts/test-file-shelf.mjs`

**Interfaces:**
- Consumes: `DroppedFile`, `Bridge.chatSend`, and `State.droppedFile`.
- Produces: `ShelfItem`, `State.shelf`, `State.addShelfItem`, `State.selectShelfItem`, `State.removeShelfItem`, `State.clearShelf`, and a single selected item mapped into `State.droppedFile` before opening chat.

- [ ] **Step 1: Write failing state tests** for add/select/remove/clear, duplicate names, and a missing selected path that cannot be attached.
- [ ] **Step 2: Run `node --experimental-strip-types windows/scripts/test-file-shelf.mjs`** and confirm it fails before the state API exists.
- [ ] **Step 3: Implement `ShelfItem` and minimal session-only state methods**; item IDs must be unique and selection must be independent from deletion.
- [ ] **Step 4: Add the chat regression test** asserting the first submitted prompt receives the selected shelf file path through `ChatContext`, while later prompts do not resend it.
- [ ] **Step 5: Update chat integration** to set/clear only the selected attachment and preserve the shelf item after successful or failed chat calls.
- [ ] **Step 6: Run the shelf and chat tests** and verify missing paths disable attachment rather than issuing `chat_send`.

### Task 3: Build the shelf UI and safe drop states

**Files:**
- Modify: `windows/src/views/upload.ts`
- Modify: `windows/src/views/views.ts`
- Modify: `windows/src/style.css`
- Modify: `windows/src/app-materials.css` only if existing material tokens are insufficient
- Test: `windows/scripts/test-file-shelf.mjs` or a focused Playwright smoke script

**Interfaces:**
- Consumes: `State.shelf`, selected shelf item, and the state methods from Task 2.
- Produces: `View shelf`, shelf rows with accessible labels, `Ask Pip`, remove, clear, retry/error affordances, and no hidden focusable shelf controls.

- [ ] **Step 1: Write failing DOM checks** for empty shelf, one item, selected item, remove, clear, missing-file disabled Ask Pip, and drop error state.
- [ ] **Step 2: Implement the shelf as an existing island view** reachable from `+`; keep it scrollable and reserve space for Pip, the header, and bottom controls.
- [ ] **Step 3: Add type glyphs, truncated labels with full-path tooltips, selected styling, and accessible button names** using existing DOM helpers and palette tokens.
- [ ] **Step 4: Add Ask Pip behavior** that selects the item as the chat context and navigates to the existing prompt view; remove must stop event propagation.
- [ ] **Step 5: Add compact upload/drop controls** so the drop surface offers View shelf only when useful and never overlaps the existing upload animation.
- [ ] **Step 6: Run DOM checks at 1x and 1.5x device scale** and assert all visible shelf controls stay inside `#island`.

### Task 4: Integrate and verify the complete flow

**Files:**
- Modify: `windows/src/views/upload.ts` if integration exposes a lifecycle bug
- Modify: `windows/src/island/island.ts` if integration exposes a lifecycle bug
- Test: `windows/scripts/test-file-shelf.mjs`

**Interfaces:**
- Consumes: native drop events, shelf state, and chat context from Tasks 1–3.
- Produces: an end-to-end tested drop → shelf → Ask Pip → chat flow.

- [ ] **Step 1: Run the full focused shelf smoke test** with mocked ingestion/chat boundaries and verify image, PDF, code, folder rejection, failure, retry, remove, clear, and Ask Pip.
- [ ] **Step 2: Run existing frontend checks:** `npx tsc --noEmit`, production Vite build, `npm run test:carousel`, and `node --experimental-strip-types scripts/test-navigation.mjs` from `windows/`.
- [ ] **Step 3: Run Rust checks:** `cargo check --manifest-path windows/src-tauri/Cargo.toml` and focused Rust tests when Cargo is available.
- [ ] **Step 4: Run a native Windows smoke test** by dragging an image and a PDF from Explorer, opening the shelf, selecting an item, and submitting an Ask Pip question.
- [ ] **Step 5: Record any environment-only gap** if the Linux container cannot run the native Windows drag/drop path; do not claim that native drag/drop passed without this check.
