// Shared hover and keyboard help. Delegation also covers cards rendered later.
export function initTooltips() {
  const tooltip = document.createElement("div");
  tooltip.id = "phraselet-tooltip";
  tooltip.className = "tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);

  let active = null;
  let hovered = null;
  let focused = null;
  let dismissed = null;
  let showTimer;
  let hideTimer;

  function triggerFrom(target) {
    const trigger = target instanceof Element ? target.closest("[data-tooltip]") : null;
    return trigger && !trigger.disabled && !trigger.closest("[hidden]") ? trigger : null;
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (active) {
      const ids = (active.getAttribute("aria-describedby") || "").split(/\s+/)
        .filter((id) => id && id !== tooltip.id);
      if (ids.length) active.setAttribute("aria-describedby", ids.join(" "));
      else active.removeAttribute("aria-describedby");
    }
    active = null;
    tooltip.hidden = true;
  }

  function position() {
    const rect = active.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const gap = 6;
    const edge = 8;
    const left = Math.max(edge, Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - edge));
    const top = rect.bottom + gap + height <= window.innerHeight - edge
      ? rect.bottom + gap
      : Math.max(edge, rect.top - height - gap);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function show(trigger, delay = 400) {
    clearTimeout(hideTimer);
    if (trigger === dismissed || (trigger === active && !tooltip.hidden)) return;
    hide();
    if (!trigger) return;
    active = trigger;
    tooltip.textContent = trigger.dataset.tooltip;
    // Icon buttons already have a name; only add a description with extra help.
    if (trigger.getAttribute("aria-label") !== tooltip.textContent) {
      const ids = new Set((trigger.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      ids.add(tooltip.id);
      trigger.setAttribute("aria-describedby", [...ids].join(" "));
    }
    showTimer = setTimeout(() => {
      if (!active?.isConnected || active.disabled || active.closest("[hidden]")) {
        hide();
        return;
      }
      tooltip.hidden = false;
      position();
    }, delay);
  }

  function leave() {
    clearTimeout(hideTimer);
    if (dismissed !== hovered && dismissed !== focused) dismissed = null;
    const next = hovered || focused;
    if (next) show(next, 0);
    else hideTimer = setTimeout(hide, 120); // Allow crossing the gap to the tooltip.
  }

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    if (tooltip.contains(event.target)) {
      hovered = active;
      clearTimeout(hideTimer);
      return;
    }
    const trigger = triggerFrom(event.target);
    if (trigger === triggerFrom(event.relatedTarget)) return;
    hovered = trigger;
    if (trigger === dismissed) dismissed = null;
    if (trigger) show(trigger);
  });

  document.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch") return;
    if (tooltip.contains(event.relatedTarget)) return;
    const next = triggerFrom(event.relatedTarget);
    if (next === hovered) return;
    hovered = next;
    leave();
  });

  document.addEventListener("focusin", (event) => {
    focused = triggerFrom(event.target);
    if (focused === dismissed) dismissed = null;
    if (focused) show(focused, 0);
  });
  document.addEventListener("focusout", () => {
    focused = null;
    leave();
  });

  function dismiss() {
    dismissed = active;
    hide();
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && active) {
      dismiss();
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  document.addEventListener("click", dismiss, true);
  document.addEventListener("scroll", dismiss, true);
  window.addEventListener("resize", dismiss);
  window.addEventListener("blur", () => {
    hovered = null;
    focused = null;
    dismissed = null;
    hide();
  });
  new MutationObserver(() => {
    if (!active) return;
    if (!active.isConnected || active.disabled || active.closest("[hidden]")) {
      hovered = null;
      focused = null;
      hide();
    } else if (tooltip.textContent !== active.dataset.tooltip) {
      tooltip.textContent = active.dataset.tooltip;
      if (!tooltip.hidden) position();
    }
  }).observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ["disabled", "hidden", "data-tooltip"]
  });
}
