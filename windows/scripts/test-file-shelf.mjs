import assert from "node:assert/strict";
import { ShelfStore, shelfAttachment, shelfKind } from "../src/core/file-shelf.ts";

assert.equal(shelfKind("photo.PNG"), "image");
assert.equal(shelfKind("brief.pdf"), "pdf");
assert.equal(shelfKind("invoice.ts"), "code");
assert.equal(shelfKind("notes.docx"), "document");

const shelf = new ShelfStore();
const first = shelf.add({ name: "notes.pdf", path: "/inbox/notes.pdf", size: 10 }, 100);
const second = shelf.add({ name: "notes.pdf", path: "/inbox/notes (2).pdf", size: 20 }, 101);
assert.notEqual(first.id, second.id);
assert.equal(shelf.items.length, 2);

assert.equal(shelf.select(first.id)?.path, "/inbox/notes.pdf");
assert.equal(shelf.selected?.id, first.id);
assert.equal(shelf.remove(first.id), true);
assert.equal(shelf.selected, null);
assert.equal(shelf.items.length, 1);

const failed = shelf.addError("broken.pdf", "C:/Users/test/broken.pdf", "cannot copy", 102);
assert.equal(failed.error, "cannot copy");
assert.equal(failed.path, "");
assert.equal(shelf.select(failed.id)?.error, "cannot copy");
assert.equal(shelf.replace(failed.id, { name: "broken.pdf", path: "/inbox/broken.pdf", size: 30 })?.error, null);
assert.equal(shelf.selected?.path, "/inbox/broken.pdf");

// The selected shelf item is the one attachment consumed by the chat boundary.
const stateLike = { droppedFile: null, promptContext: null };
const selected = shelf.selected;
assert.equal(selected?.path, "/inbox/broken.pdf");
stateLike.droppedFile = { name: selected.name, path: selected.path };
stateLike.promptContext = { kind: "file", name: selected.name, path: selected.path };
assert.deepEqual(stateLike.promptContext, { kind: "file", name: "broken.pdf", path: "/inbox/broken.pdf" });
stateLike.droppedFile = null;
stateLike.promptContext = null;
assert.equal(shelf.selected?.path, "/inbox/broken.pdf", "chat consumes the attachment, not the shelf item");
assert.deepEqual(shelfAttachment(shelf.selected), { kind: "file", name: "broken.pdf", path: "/inbox/broken.pdf" });
assert.equal(shelfAttachment({ ...shelf.selected, error: "missing" }), null);

shelf.clear();
assert.deepEqual(shelf.items, []);
assert.equal(shelf.selected, null);
console.log("file shelf state: ok");
