// Drop zone, upload progress and the "what do you want to do with it" card —
// ports of UploadView / UploadingView / ChooseView from IslandViewContent.swift.
//
// Sending a file by email is not in the Windows v1, so `choose` offers the one
// action the spec asks for: ask a question about it.

import { h, clear } from "./dom";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import type { ViewActions, ViewHost } from "./views";

/** Dashed rounded rect drawn as SVG so the dashes can march like on macOS. */
function dashedFrame(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("class", "drop-frame");
  el.setAttribute("preserveAspectRatio", "none");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", "0.75");
  rect.setAttribute("y", "0.75");
  rect.setAttribute("width", "calc(100% - 1.5px)");
  rect.setAttribute("height", "calc(100% - 1.5px)");
  rect.setAttribute("rx", "20");
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke-width", "1.5");
  rect.setAttribute("stroke-dasharray", "6 5");
  el.append(rect);
  return el;
}

const SHELF_GLYPHS = { image: "▧", pdf: "▤", code: "❯", document: "▱", other: "•" } as const;

export function buildUpload(actions: ViewActions): ViewHost {
  const frame = dashedFrame();
  const title = h("div", { class: "drop-title", text: "Drop your files here" });
  const tags = h(
    "div",
    { class: "drop-tags" },
    ...["PDF", "Images", "Code", "Docs"].map((t) => h("span", { text: t })),
  );
  const focusShelfTrigger = () => window.setTimeout(() => document.querySelector<HTMLElement>(State.shelfOpen ? ".shelf-actions button" : ".drop-shelf-button")?.focus(), 0);
  const shelfButton = h("button", {
    class: "btn secondary drop-shelf-button",
    type: "button",
    text: "View shelf",
    onclick: () => {
      State.shelfOpen = true;
      State.notify();
      focusShelfTrigger();
    },
  });
  const card = h(
    "div",
    { class: "card drop-card" },
    frame,
    h("div", { class: "drop-body" }, title, tags, shelfButton),
  );

  const shelfList = h("div", { class: "shelf-list" });
  const shelfTitle = h("div", { class: "shelf-title", text: "Temporary shelf" });
  const shelfSub = h("div", { class: "shelf-sub", text: "Files stay here for this session." });
  const ask = h("button", {
    class: "btn primary",
    type: "button",
    text: "Ask Pip",
    onclick: async () => {
      const item = State.shelf.selected;
      if (!item || item.error || !item.path) return;
      const exists = await Bridge.fileExists(item.path);
      if (!exists) {
        item.error = "This file is no longer available.";
        State.notify();
        return;
      }
      if (!State.attachSelectedShelfItem()) return;
      State.shelfOpen = false;
      actions.setView("prompt");
    },
  });
  const back = h("button", {
    class: "btn secondary",
    type: "button",
    text: "Back to drop",
    onclick: () => {
      State.shelfOpen = false;
      State.notify();
      focusShelfTrigger();
    },
  });
  const clearShelf = h("button", {
    class: "link-btn shelf-clear",
    type: "button",
    text: "Clear",
    onclick: () => State.clearShelf(),
  });
  const shelfCard = h(
    "div",
    { class: "card shelf-card" },
    h("div", { class: "shelf-head" }, h("div", {}, shelfTitle, shelfSub), clearShelf),
    shelfList,
    h("div", { class: "shelf-actions" }, back, ask),
  );
  const el = h("div", { class: "view" }, card, shelfCard);
  shelfCard.style.display = "none";

  let renderedKey = "";
  function renderShelf() {
    const key = `${State.shelf.selectedId}|${State.shelf.items.map((item) => `${item.id}:${item.error ?? ""}:${item.path}`).join("|")}`;
    if (key === renderedKey) return;
    renderedKey = key;
    clear(shelfList);
    for (const item of State.shelf.items) {
      const row = h("div", {
        class: `shelf-row${item.id === State.shelf.selectedId ? " selected" : ""}${item.error ? " error" : ""}`,
      });
      const select = h("button", {
        class: "shelf-select",
        type: "button",
        "aria-label": `${item.name}, ${item.kind}${item.error ? ", unavailable" : ""}`,
        title: item.error || item.path || item.sourcePath || item.name,
        onclick: () => State.selectShelfItem(item.id),
      }, h("span", { class: "shelf-glyph", text: SHELF_GLYPHS[item.kind] }),
        h("span", { class: "shelf-name", text: item.name }),
        h("span", { class: "shelf-status", text: item.error ? "Retry" : item.kind }),
      );
      const remove = h("button", {
        class: "shelf-remove",
        type: "button",
        "aria-label": `Remove ${item.name}`,
        text: "×",
        onclick: (event: Event) => {
          event.stopPropagation();
          State.removeShelfItem(item.id);
        },
      });
      row.append(select, remove);
      if (item.error && item.sourcePath) {
        const retry = h("button", {
          class: "shelf-retry",
          type: "button",
          text: "Retry",
          onclick: () => void Bridge.ingestFile(item.sourcePath!).then((file) => State.replaceShelfItem(item.id, file)).catch((err) => {
            item.error = String(err).replace(/^Error:\s*/, "");
            State.notify();
          }),
        });
        row.append(retry);
      }
      shelfList.append(row);
    }
  }

  return {
    el,
    sync() {
      card.classList.toggle("over", State.fileDragOver);
      card.style.display = State.shelfOpen ? "none" : "";
      shelfCard.style.display = State.shelfOpen ? "flex" : "none";
      shelfButton.style.display = State.shelf.items.length > 0 ? "" : "none";
      const selected = State.shelf.selected;
      ask.disabled = !selected || Boolean(selected.error) || !selected.path;
      if (selected?.error) ask.title = selected.error;
      else ask.removeAttribute("title");
      renderShelf();
    },
  };
}

export function buildUploading(): ViewHost {
  const label = h("span", { class: "up-name" });
  const percent = h("span", { class: "up-pct" });
  const fill = h("div", { class: "up-fill" });
  const glow = h("div", { class: "up-glow" });
  const card = h(
    "div",
    { class: "card up-card" },
    h("div", { class: "up-row" }, label, percent),
    h("div", { class: "up-track" }, fill, glow),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      const done = State.uploadProgress >= 0.999;
      const pct = Math.round(State.uploadProgress * 100);
      label.textContent = done
        ? `✓  ${State.droppedFile?.name ?? State.uploadingName ?? "File"}`
        : `Uploading ${State.droppedFile?.name ?? State.uploadingName ?? "file"}`;
      label.classList.toggle("done", done);
      percent.textContent = done ? "" : `${pct} %`;
      const w = State.uploadProgress * 526;
      fill.style.width = `${w}px`;
      glow.style.transform = `translateX(${Math.max(0, w - 14)}px)`;
      glow.style.opacity = State.uploadProgress > 0.01 ? "1" : "0";
      card.classList.toggle("done", done);
    },
  };
}

export function buildChoose(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub", text: "What do you want to do with it?" });
  const row = h(
    "div",
    { class: "actions" },
    h("button", {
      class: "btn primary",
      text: "Ask a question",
      onclick: () => actions.setView("prompt"),
    }),
    h("button", {
      class: "btn secondary",
      text: "Cancel",
      onclick: () => {
        State.droppedFile = null;
        State.notify();
        actions.setView(State.defaultView());
      },
    }),
  );
  const el = h(
    "div",
    { class: "view" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title, sub, row),
    ),
  );

  return {
    el,
    sync() {
      clear(title);
      title.append(
        h("b", { text: State.droppedFile?.name ?? "file" }),
        document.createTextNode(" is ready."),
      );
    },
  };
}
