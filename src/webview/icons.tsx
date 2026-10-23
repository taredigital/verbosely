// The feed's drawn icons, in the text colour (12 px, on a 16 px grid).

export function BookmarkIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M4 1.5h8v13l-4-3-4 3z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function NoteIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M2 2.5h12v8.5H7.5L4.5 14v-3H2z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Beside a flagged step: a warning sign, drawn so it looks the same in every font. */
export function WarningIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M8 1.8 15 14H1z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <path
        d="M8 6v4"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <circle cx="8" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}
