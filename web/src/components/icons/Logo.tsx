import type { SVGProps } from 'react';

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 22h16" />
      <path d="M10 2l-4 16" />
      <path d="M14 2l4 16" />
      <path d="M12 6v2" />
      <path d="M12 12v2" />
    </svg>
  );
}
