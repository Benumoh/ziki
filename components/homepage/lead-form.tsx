"use client";

import { useActionState, useId } from 'react';
import Link from 'next/link';
import { captureLeadAction, type LeadFormState } from '@/app/actions/leads';
import type { LEAD_SOURCES } from '@/lib/validations/lead';

type LeadFormProps = {
  source: (typeof LEAD_SOURCES)[number];
  /** `short` asks for an email only; `full` also asks for a name and what they want done. */
  variant?: 'short' | 'full';
  button: string;
  /** Where "start now" leads once the details are in. */
  startHref: string;
};

/**
 * A lead form on a public page (#how-it-works-leads): the visitor leaves their details without leaving the page,
 * and is thanked in place with a way to start at once.
 */
export function LeadForm({ source, variant = 'short', button, startHref }: LeadFormProps) {
  const [state, action, pending] = useActionState<LeadFormState, FormData>(captureLeadAction, undefined);
  const id = useId();

  if (state?.ok) {
    return (
      <div className={`lead-form lead-form-${variant} lead-form-done`} role="status">
        <b>Thanks, you’re on the list.</b>
        <span>We’ll get back to you within a day. Want to start now? <Link href={startHref}>Add your app</Link></span>
      </div>
    );
  }

  const error = state && !state.ok ? state : null;
  return (
    <form className={`lead-form lead-form-${variant}`} action={action} noValidate>
      <input type="hidden" name="source" value={source} />
      {/* People never see this field; bots fill it in. */}
      <input className="lead-form-trap" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      {variant === 'full' ? (
        <>
          <label className="lead-field">
            <span>Your name</span>
            <input name="name" type="text" autoComplete="name" maxLength={100} aria-invalid={error?.field === 'name' || undefined} />
          </label>
          <label className="lead-field lead-field-wide">
            <span>What should agents work on first?</span>
            <textarea name="goal" rows={3} maxLength={1000} placeholder="For example: the checkout keeps timing out, and we need a launch page." aria-invalid={error?.field === 'goal' || undefined} />
          </label>
        </>
      ) : null}
      <div className="lead-row">
        <label className="lead-field lead-field-email">
          <span className={variant === 'short' ? 'sr-only' : undefined}>Work email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            aria-invalid={error?.field === 'email' || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </label>
        <button className="th-btn th-btn-primary th-btn-lg" type="submit" disabled={pending}>{pending ? 'Sending…' : button}</button>
      </div>
      {error ? <p className="lead-error" id={`${id}-error`} role="alert">{error.error}</p> : null}
    </form>
  );
}
