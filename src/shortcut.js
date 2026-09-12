export async function renderAssignedShortcut() {
  const labels = document.querySelectorAll("[data-shortcut-label]");
  if (!labels.length || typeof chrome.commands?.getAll !== "function") {
    return;
  }

  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find(({ name }) => name === "save-selected-snippet");
    const shortcut = command?.shortcut || "Not assigned";
    labels.forEach((label) => {
      label.textContent = shortcut;
      label.setAttribute("aria-label", shortcut);
    });
  } catch {
    // The manifest default remains visible if Chrome cannot read commands.
  }
}
