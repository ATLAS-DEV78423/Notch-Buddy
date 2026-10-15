export type ShelfKind = "image" | "pdf" | "code" | "document" | "other";

export interface ShelfFile {
  name: string;
  path: string;
  size: number | null;
}

export interface ShelfItem extends ShelfFile {
  id: string;
  kind: ShelfKind;
  addedAt: number;
  error: string | null;
  sourcePath: string | null;
}

export interface ShelfAttachment {
  kind: "file";
  name: string;
  path: string;
}

export function shelfAttachment(item: ShelfItem | null): ShelfAttachment | null {
  if (!item || item.error || !item.path) return null;
  return { kind: "file", name: item.name, path: item.path };
}

const extension = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

export function shelfKind(name: string): ShelfKind {
  const ext = extension(name);
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "java", "swift", "css", "html", "json", "yaml", "yml", "toml", "sh", "ps1"].includes(ext)) return "code";
  if (["txt", "md", "rtf", "doc", "docx", "odt", "xls", "xlsx", "csv", "ppt", "pptx"].includes(ext)) return "document";
  return "other";
}

export class ShelfStore {
  items: ShelfItem[] = [];
  selectedId: string | null = null;
  private nextId = 1;

  get selected(): ShelfItem | null {
    return this.items.find((item) => item.id === this.selectedId) ?? null;
  }

  add(file: ShelfFile, now = Date.now()): ShelfItem {
    const item: ShelfItem = {
      ...file,
      id: `shelf-${this.nextId++}`,
      kind: shelfKind(file.name),
      addedAt: now,
      error: null,
      sourcePath: null,
    };
    this.items.push(item);
    return item;
  }

  addError(name: string, sourcePath: string, error: string, now = Date.now()): ShelfItem {
    const item: ShelfItem = {
      id: `shelf-${this.nextId++}`,
      name,
      path: "",
      size: null,
      kind: shelfKind(name),
      addedAt: now,
      error,
      sourcePath,
    };
    this.items.push(item);
    return item;
  }

  replace(id: string, file: ShelfFile): ShelfItem | null {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return null;
    Object.assign(item, file, { kind: shelfKind(file.name), error: null, sourcePath: null });
    return item;
  }

  select(id: string | null): ShelfItem | null {
    if (id === null) {
      this.selectedId = null;
      return null;
    }
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return null;
    this.selectedId = id;
    return item;
  }

  remove(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    if (this.selectedId === id) this.selectedId = null;
    return true;
  }

  clear() {
    this.items = [];
    this.selectedId = null;
  }
}
