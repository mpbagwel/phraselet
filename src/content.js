let toastHost;
let toastTimer;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PAUSEMARK_GET_SELECTION") {
    sendResponse(getSelectionPayload());
    return true;
  }

  if (message?.type === "PAUSEMARK_SHOW_TOAST") {
    showToast(message.message, message.tone);
    return false;
  }

  return false;
});

document.addEventListener("selectionchange", notifySelectionChanged);
document.addEventListener("keyup", notifySelectionChanged);
document.addEventListener("mouseup", notifySelectionChanged);

function getSelectionPayload() {
  const formSelection = getFormSelectionPayload();
  if (formSelection.selectedText) {
    return formSelection;
  }

  const selection = window.getSelection();
  const selectedText = cleanText(selection?.toString());

  return {
    selectedText,
    contextText: selectedText ? findContextText(selection) : "",
    sourceTitle: document.title,
    sourceUrl: location.href
  };
}

function notifySelectionChanged() {
  const payload = getSelectionPayload();

  if (!payload.selectedText) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "PAUSEMARK_SELECTION_CHANGED",
    payload
  }).catch(() => undefined);
}

function getFormSelectionPayload() {
  const element = document.activeElement;

  if (!isSelectableFormElement(element)) {
    return emptyPayload();
  }

  let start;
  let end;
  try {
    start = element.selectionStart;
    end = element.selectionEnd;
  } catch {
    return emptyPayload();
  }

  if (typeof start !== "number" || typeof end !== "number" || start === end) {
    return emptyPayload();
  }

  const selectedText = cleanText(element.value.slice(start, end));

  return {
    selectedText,
    contextText: selectedText ? cleanText(element.value) : "",
    sourceTitle: document.title,
    sourceUrl: location.href
  };
}

function isSelectableFormElement(element) {
  return element instanceof HTMLTextAreaElement
    || element instanceof HTMLInputElement && /^(search|tel|text|url)$/i.test(element.type);
}

function emptyPayload() {
  return {
    selectedText: "",
    contextText: "",
    sourceTitle: document.title,
    sourceUrl: location.href
  };
}

function showToast(message, tone) {
  const host = getToastHost();
  const toast = host.shadowRoot.querySelector("[data-toast]");
  toast.textContent = cleanText(message);
  toast.dataset.tone = tone === "error" ? "error" : "success";
  toast.dataset.visible = "true";

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.dataset.visible = "false";
  }, 2200);
}

function getToastHost() {
  if (toastHost?.isConnected) {
    return toastHost;
  }

  toastHost = document.createElement("div");
  toastHost.id = "pausemark-toast-host";
  const shadow = toastHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      [data-toast] {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 36px));
        padding: 11px 13px;
        border-radius: 8px;
        box-shadow: 0 10px 30px rgb(23 32 38 / 22%);
        color: #fff;
        font: 13px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: 0;
        overflow-wrap: anywhere;
        pointer-events: none;
        transform: translateY(8px);
        transition: opacity 150ms ease, transform 150ms ease;
      }

      [data-toast][data-tone="success"] {
        background: #255f85;
      }

      [data-toast][data-tone="error"] {
        background: #a43d3d;
      }

      [data-toast][data-visible="true"] {
        opacity: 1;
        transform: translateY(0);
      }
    </style>
    <div data-toast data-tone="success" data-visible="false" role="status" aria-live="polite"></div>
  `;
  document.documentElement.append(toastHost);
  return toastHost;
}

function findContextText(selection) {
  if (!selection || selection.rangeCount === 0) {
    return "";
  }

  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const block = element?.closest("p, li, blockquote, article, section, main, div");
  const blockText = cleanText(block?.innerText || block?.textContent);

  if (blockText && blockText.length <= 900) {
    return blockText;
  }

  if (blockText) {
    return sentenceWindow(blockText, cleanText(selection.toString()));
  }

  return sentenceWindow(cleanText(document.body?.innerText), cleanText(selection.toString()));
}

function sentenceWindow(text, selectedText) {
  if (!text || !selectedText) {
    return "";
  }

  const index = text.toLowerCase().indexOf(selectedText.toLowerCase());
  if (index === -1) {
    return text.slice(0, 900);
  }

  const start = Math.max(0, index - 360);
  const end = Math.min(text.length, index + selectedText.length + 360);
  return text.slice(start, end).replace(/^\S*\s/, "").replace(/\s\S*$/, "");
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
