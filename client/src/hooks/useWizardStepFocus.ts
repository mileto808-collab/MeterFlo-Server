import { useEffect, useRef, type RefObject } from "react";

/** Focus only on navigation/outcome changes, never on each edit or live refresh. */
export function useWizardStepFocus({
  open, ready, stepKey, rootRef, bodyRef, chooseTarget,
}: {
  open: boolean;
  ready: boolean;
  stepKey: string;
  rootRef: RefObject<HTMLDivElement>;
  bodyRef: RefObject<HTMLDivElement>;
  chooseTarget: (root: HTMLDivElement) => HTMLElement | null;
}) {
  const choose = useRef(chooseTarget);
  const lastStep = useRef<string | null>(null);
  const highlighted = useRef<HTMLElement | null>(null);
  useEffect(() => { choose.current = chooseTarget; });

  useEffect(() => {
    if (!open || !ready) {
      lastStep.current = null;
      highlighted.current?.removeAttribute("data-wizard-focus-target");
      return;
    }
    if (lastStep.current === stepKey) return;
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;
    let resizeFrame = 0;
    let observer: ResizeObserver | undefined;
    let target: HTMLElement | null = null;
    const align = () => {
      if (!target?.isConnected) return;
      if (body.contains(target)) {
        const top = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
        const context = Math.max(8, Math.min(96, (body.clientHeight - target.offsetHeight) / 2));
        body.scrollTo({ top: Math.max(0, top - context), behavior: "instant" });
      } else body.scrollTo({ top: 0, behavior: "instant" });
    };
    const clearHighlight = (event: FocusEvent) => {
      if (event.target !== target) highlighted.current?.removeAttribute("data-wizard-focus-target");
    };
    const frame = requestAnimationFrame(() => {
      target = choose.current(root);
      if (!target) return;
      highlighted.current?.removeAttribute("data-wizard-focus-target");
      highlighted.current = target;
      target.setAttribute("data-wizard-focus-target", "true");
      lastStep.current = stepKey;
      align();
      target.focus({ preventScroll: true });
      document.addEventListener("focusin", clearHighlight);
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          if (document.activeElement === target) align();
        });
      });
      observer.observe(body);
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      document.removeEventListener("focusin", clearHighlight);
      highlighted.current?.removeAttribute("data-wizard-focus-target");
    };
  }, [open, ready, stepKey, rootRef, bodyRef]);
}
