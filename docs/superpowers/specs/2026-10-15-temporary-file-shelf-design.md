# Temporary File Shelf Design

## Goal

Make the Windows/Linux drop surface a reliable, useful temporary shelf for
images, PDFs, code, and documents. A user can drop files, keep them available
for the current app session, ask Pip about a selected file, and remove items
without losing unrelated shelf entries.

## Scope

### Included

- Native Tauri drag/drop ingestion for files, including the Windows drop-target
  handoff already present in the platform layer.
- Session-only shelf state owned by the front-end.
- Shelf access from the existing `+` drop entry point.
- File metadata: display name, copied path, extension/type, size, and added time.
- Add, retry, select, ask Pip, remove, and clear shelf actions.
- Clear pending shelf selection when the source file is consumed by chat.
- User-visible error state when copying or reading a dropped path fails.

### Excluded

- Cloud storage, synchronization, or permanent document management.
- Automatic OCR or PDF parsing in the desktop client.
- More than one attachment in a single chat request until the provider payload
  contract explicitly supports it.
- Background expiration timers during this change. The shelf is session-only and
  is discarded on app restart; copied inbox files remain governed by the
  existing inbox lifecycle.

## User flow

1. The user opens the `+` surface or drags files over the island.
2. The drop surface visibly accepts the file. Unsupported folders are rejected
   with a clear message instead of silently doing nothing.
3. Each accepted file is copied to the existing inbox. The item appears in the
   shelf after the copy succeeds; a failed copy remains represented as a
   retryable error item.
4. The user opens the shelf from `+`, selects an item, and chooses **Ask Pip**.
5. Chat opens with the selected file chip. The first submitted question sends
   the file path through the existing `ChatContext` flow.
6. On successful submission, the selected attachment is consumed from chat
   context but remains in the shelf until the user removes it.
7. Remove deletes the item from shelf state. Clear removes all shelf entries;
   it does not delete files from disk unless the existing inbox cleanup already
   owns them.

## State and data flow

`Bridge.onDragDrop` → `Island.onDragDrop` → `Bridge.ingestFile` →
`State.addShelfItem` → shelf view.

The shelf item contains only non-secret local metadata:

```ts
interface ShelfItem {
  id: string;
  name: string;
  path: string;
  kind: "image" | "pdf" | "code" | "document" | "other";
  size: number | null;
  addedAt: number;
  error: string | null;
  sourcePath?: string;
}
```

The native command continues to copy user files into the inbox and returns the
copied path. It must validate that the path is a regular file, preserve the
existing filename collision behavior, and return an actionable error for
folders or inaccessible files.

## UI structure

- The existing `+` tab remains the entry point.
- The drop view gets a **View shelf** control when the shelf is non-empty.
- The shelf is a compact scrollable card using the existing dark graphite
  materials, not a new window.
- Each row shows a type glyph, truncated name with a full-path tooltip, and a
  remove control.
- The selected row is visually distinct and has **Ask Pip** as the primary
  action.
- Uploading and error states are inline and reserve space for their actions;
  they do not overlap the existing Mochi or header.
- Empty shelf state explains that dropped files stay available for this session.

## Error handling

- Native drag/drop errors are shown in the existing note surface with the
  original safe error text.
- A failed copy does not create a misleading usable attachment.
- A missing shelf file disables **Ask Pip** and offers remove; no chat request
  is sent with a path that no longer exists.
- Chat failures preserve the shelf item and return focus to the chat input.

## Accessibility and interaction

- Shelf rows are buttons with accessible names containing the filename and type.
- Remove controls have independent labels and do not select the row.
- Escape closes the shelf/detail surface without deleting items.
- Keyboard focus remains within the visible control flow and never lands on a
  hidden shelf control.

## Verification

- Headless tests cover shelf add/select/remove/clear and missing-file behavior.
- A drop regression test covers file, folder rejection, copy failure, and the
  returned path reaching `ChatContext`.
- `npx tsc --noEmit`, the production Vite build, existing carousel/navigation
  tests, and Rust `cargo check` run from `windows/`.
- A Windows smoke test confirms dragging an image and PDF from Explorer reaches
  the shelf and opens Ask Pip.
