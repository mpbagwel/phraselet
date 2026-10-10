export async function renderAssignedShortcut() {
  const labels = document.querySelectorAll("[data-shortcut-label]");
  if (!labels.length || typeof globalThis.chrome?.commands?.getAll !== "function") {
    return;
  }

  document.querySelectorAll("[data-set-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    });
  });

  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find(({ name }) => name === "save-selected-snippet");
    const shortcut = formatShortcutLabel(command?.shortcut || "Not assigned");
    labels.forEach((label) => {
      label.textContent = shortcut;
      label.setAttribute("aria-label", shortcut);
    });
    document.querySelectorAll("[data-shortcut-help]").forEach((help) => {
      help.hidden = Boolean(command?.shortcut);
    });
  } catch {
    // The manifest default remains visible if Chrome cannot read commands.
  }
}

function formatShortcutLabel(shortcut) {
  const keys = shortcut.toUpperCase().replace(/\s+/g, "")
    .replace(/OPTION/g, "ALT")
    .replace(/⌥/g, "ALT+")
    .replace(/⇧/g, "SHIFT+")
    .split("+").filter(Boolean);
  if (keys.length === 3 && keys[2] === "P" && keys.includes("ALT") && keys.includes("SHIFT")) {
    return "Option+Shift+P";
  }
  return shortcut;
}
