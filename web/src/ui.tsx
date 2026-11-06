import { useState } from 'react';
import type { Usage } from './lib';

/** A small burst of sparks from the top of the screen. Hidden by CSS for reduced-motion users. */
export function celebrate() {
  const colours = ['#ffc627', '#8c1d40', '#e8a33d'];
  for (let i = 0; i < 18; i++) {
    const el = document.createElement('span');
    const angle = (i / 18) * Math.PI * 2;
    const distance = 90 + Math.random() * 110;
    el.className = 'spark';
    el.textContent = '✦';
    el.style.cssText = `left:50%;top:150px;font-size:${10 + Math.random() * 12}px;color:${colours[i % 3]}`;
    el.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    el.style.setProperty('--y', `${Math.sin(angle) * distance}px`);
    el.addEventListener('animationend', () => el.remove());
    document.body.append(el);
  }
}

const LOW_MINUTES = 15;
const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
export const outOfBudget = (u: Usage) => u.spentUsd >= u.budgetUsd || u.paused;

export function UsageMeter({ usage }: { usage: Usage }) {
  const percent = Math.min(100, (usage.spentUsd / usage.budgetUsd) * 100);
  const colour = outOfBudget(usage) ? 'bg-rec' : usage.minutesLeft < LOW_MINUTES ? 'bg-spark' : 'bg-brand';
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="mb-2 flex flex-wrap justify-between gap-x-3 text-sm">
        <span className="font-semibold">{money(usage.spentUsd)} of {money(usage.budgetUsd)} used this month</span>
        <span className="text-muted">About {usage.minutesLeft} min left · resets on the 1st</span>
      </div>
      <div role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly budget used" className="h-2 overflow-hidden rounded-full bg-tint">
        <div className={`h-full rounded-full transition-all ${colour}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Tells people before they record, so a meeting isn't wasted. Silent when there's plenty left. */
export function UsageNotice({ usage }: { usage: Usage }) {
  if (usage.paused) {
    return <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-rec">Maazin has reached its monthly limit for everyone. It resets on the 1st.</p>;
  }
  if (outOfBudget(usage)) {
    return <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-rec">You've used your {money(usage.budgetUsd)} for this month, so recording is off until the 1st.</p>;
  }
  if (usage.minutesLeft < LOW_MINUTES) {
    return <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm font-medium text-amber-900">Heads up: you have about {usage.minutesLeft} minutes left this month.</p>;
  }
  return null;
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button type="button" onClick={copy} className="btn">
      {copied ? '✓ Copied!' : label}
    </button>
  );
}
