import { useEffect, useRef, type RefObject } from "react";

/**
 * Inventory step guidance is visual, never keyboard focus. Navigation starts at
 * the top; editing/scrolling only updates the next incomplete-field indicator.
 * The historical hook name is retained for existing callers.
 */
export function useWizardStepFocus({
  open, ready, stepKey, rootRef, bodyRef, chooseTarget,
}: {
  open: boolean;
  ready: boolean;
  stepKey: string;
  rootRef: RefObject<HTMLElement>;
  bodyRef: RefObject<HTMLElement>;
  chooseTarget: (root: HTMLElement) => HTMLElement | null;
}) {
  const choose = useRef(chooseTarget);
  const lastStep = useRef<string | null>(null);
  const highlighted = useRef<HTMLElement | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  useEffect(() => { choose.current = chooseTarget; refresh.current(); });

  useEffect(() => {
    if (!open) {
      lastStep.current = null;
      highlighted.current?.removeAttribute("data-wizard-focus-target");
      return;
    }
    if (!ready) return;
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;
    let frame = 0;
    const visible = (element: HTMLElement) =>
      !element.matches(":disabled, [aria-disabled=true]") && element.getClientRects().length > 0;
    const updateHighlight = () => {
      // Prefer explicit validation state; don't guess that a nonempty serial
      // field is valid or mark optional search/filter inputs as required.
      const candidates = [...root.querySelectorAll<HTMLElement>(
        '[data-wizard-needs-input="true"],[aria-invalid="true"],:required:invalid',
      )].filter(visible);
      const bounds = body.getBoundingClientRect();
      const target = candidates.find(element => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      }) ?? candidates[0] ?? choose.current(root);
      if (target === highlighted.current) return;
      highlighted.current?.removeAttribute("data-wizard-focus-target");
      highlighted.current = target;
      target?.setAttribute("data-wizard-focus-target", "true");
    };
    const scheduleHighlight = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateHighlight);
    };
    refresh.current = scheduleHighlight;
    if (lastStep.current !== stepKey) {
      lastStep.current = stepKey;
      // Dismiss a keyboard from the previous step, but never open one.
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.contains(active) &&
          active.matches('input,textarea,[contenteditable="true"]')) active.blur();
      body.scrollTo({ top: 0, behavior: "instant" });
    }
    scheduleHighlight();
    body.addEventListener("scroll", scheduleHighlight, { passive: true });
    root.addEventListener("input", scheduleHighlight);
    root.addEventListener("change", scheduleHighlight);
    const observer = new MutationObserver(scheduleHighlight);
    observer.observe(root, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["data-wizard-needs-input", "aria-invalid", "aria-checked", "disabled"],
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      body.removeEventListener("scroll", scheduleHighlight);
      root.removeEventListener("input", scheduleHighlight);
      root.removeEventListener("change", scheduleHighlight);
      refresh.current = () => undefined;
      highlighted.current?.removeAttribute("data-wizard-focus-target");
      highlighted.current = null;
    };
  }, [open, ready, stepKey, rootRef, bodyRef]);
}
