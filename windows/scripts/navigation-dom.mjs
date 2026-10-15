// Only the DOM operations used by header.ts/dom.ts. No layout, CSS, native focus
// traversal or browser default actions are simulated by this interaction harness.
export function createDOM() {
  class Node {
    constructor(tagName) {
      this.tagName = tagName;
      this.parentNode = null;
      this.children = [];
      this.attributes = new Map();
      this.listeners = [];
      this.style = {};
      this.open = false;
      this.text = "";
    }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    set className(value) { this.setAttribute("class", value); }
    get className() { return this.getAttribute("class") ?? ""; }
    set title(value) { this.setAttribute("title", value); }
    get title() { return this.getAttribute("title") ?? ""; }
    get classList() {
      return {
        contains: (name) => this.className.split(" ").includes(name),
        toggle: (name, on) => {
          const names = new Set(this.className.split(" ").filter(Boolean));
          if (on ?? !names.has(name)) names.add(name);
          else names.delete(name);
          this.className = [...names].join(" ");
        },
      };
    }
    append(...children) {
      for (const child of children) {
        child.parentNode?.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
      }
    }
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
    }
    get firstChild() { return this.children[0] ?? null; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) {
      for (const child of [...this.children]) this.removeChild(child);
      this.text = value;
    }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    focus() { document.activeElement = this; }
    addEventListener(type, callback, options = false) {
      this.listeners.push({ type, callback, capture: options === true || !!options.capture });
    }
    dispatch(type, properties = {}) {
      const event = {
        type, target: this, defaultPrevented: false, stopped: false, ...properties,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
      };
      const path = [];
      for (let node = this; node; node = node.parentNode) path.push(node);
      const deliver = (node, capture) => {
        for (const listener of node.listeners) {
          if (listener.type === type && listener.capture === capture) listener.callback(event);
        }
      };
      for (const node of [...path].reverse()) {
        deliver(node, true);
        if (event.stopped) return event;
      }
      for (const node of path) {
        deliver(node, false);
        if (event.stopped) break;
      }
      return event;
    }
  }
  const window = new Node("WINDOW");
  const document = new Node("DOCUMENT");
  document.createElement = (tag) => new Node(tag.toUpperCase());
  document.createElementNS = (_namespace, tag) => new Node(tag.toUpperCase());
  document.createTextNode = (text) => {
    const node = new Node("#TEXT");
    node.textContent = text;
    return node;
  };
  document.body = document.createElement("body");
  document.activeElement = document.body;
  window.append(document);
  document.append(document.body);
  return { window, document };
}
