import { useState } from 'react';

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
