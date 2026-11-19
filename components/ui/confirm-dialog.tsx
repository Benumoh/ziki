"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";

export type ConfirmOptions = {
  /** Short question, shown as the dialog's heading. */
  title: string;
  /** Optional sentence explaining what the action will do. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" reddens the confirm button and starts focus on Cancel. */
  tone?: "danger" | "primary";
  /** A small picture above the heading (decorative); with it the heading and text are centred. */
  art?: React.ReactNode;
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * Ask the user to confirm an action. Resolves true if they confirm, false if
 * they cancel, press Escape or dismiss the dialog.
 *
 * Without a provider this falls back to the browser's own prompt: an
 * unstyled dialog is a far smaller problem than a delete that happens with
 * no question asked. This file is the only place `window.confirm` may appear.
 */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  return (
    confirm ??
    (async ({ title, body }) =>
      window.confirm(body ? `${title}\n\n${body}` : title))
  );
}

type Request = { options: ConfirmOptions; resolve: (ok: boolean) => void };

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback<Confirm>(
    (options) => new Promise<boolean>((resolve) => setRequest({ options, resolve })),
    [],
  );

  // showModal() is what gives us the focus trap, the inert background and
  // Escape handling; the `open` attribute alone gives none of them.
  useEffect(() => {
    if (request) dialogRef.current?.showModal();
  }, [request]);

  const settle = useCallback(
    (ok: boolean) => {
      dialogRef.current?.close();
      request?.resolve(ok);
      setRequest(null);
    },
    [request],
  );

  const options = request?.options;
  const danger = options?.tone === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <dialog
          ref={dialogRef}
          aria-labelledby="confirm-title"
          aria-describedby={options?.body ? "confirm-body" : undefined}
          // Escape and the backdrop both reach us as `cancel`, so one handler
          // covers every way of dismissing without choosing.
          onCancel={(event) => {
            event.preventDefault();
            settle(false);
          }}
          className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-card p-5 text-slate-900 shadow-xl backdrop:bg-black/50"
        >
          {options?.art ? <div className="mb-3">{options.art}</div> : null}
          <h2 id="confirm-title" className={`text-base font-semibold ${options?.art ? "text-center" : ""}`}>
            {options?.title}
          </h2>
          {options?.body ? (
            <p id="confirm-body" className={`mt-2 text-sm text-slate-600 ${options?.art ? "text-center" : ""}`}>
              {options.body}
            </p>
          ) : null}
          <div className={`mt-5 flex gap-2 ${options?.art ? "justify-center" : "justify-end"}`}>
            <Button
              type="button"
              variant="secondary"
              // On a destructive action the safe choice takes focus, so
              // Enter on a dialog you did not expect cancels it.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={danger}
              onClick={() => settle(false)}
            >
              {options?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              type="button"
              variant={danger ? "danger" : "primary"}
              // Dialog focus management, mirroring the cancel button above.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={!danger}
              onClick={() => settle(true)}
            >
              {options?.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </dialog>
      ) : null}
    </ConfirmContext.Provider>
  );
}
