import Link from "next/link";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <ellipse cx="17" cy="19" rx="15" ry="6" fill="none" stroke="#6BD0E4" strokeWidth="1.6" transform="rotate(-18 17 19)" />
      <path d="M17 5 C21 10 23 13 23 17 C23 21 20 24 17 24 C14 24 11 21 11 17 C11 14 13 12 14 10 C15 13 16 14 17 14 C17 11 16 8 17 5 Z" fill="#F08A24" />
      <circle cx="30" cy="13" r="2" fill="#6BD0E4" />
    </svg>
  );
}

export default function Brand({ size = 28 }: { size?: number }) {
  return (
    <Link className="brand" href="/">
      <Logo size={size} />
      <span>Almatafi</span>
    </Link>
  );
}
