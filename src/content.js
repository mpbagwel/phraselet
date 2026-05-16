chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PAUSEMARK_GET_SELECTION") {
    return false;
  }

  sendResponse(getSelectionPayload());
  return true;
});

function getSelectionPayload() {
  const selection = window.getSelection();
  const selectedText = cleanText(selection?.toString());

  return {
    selectedText,
    contextText: selectedText ? findContextText(selection) : "",
    sourceTitle: document.title,
    sourceUrl: location.href
  };
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
