import type { SVGProps } from "react";

export type IconName =
  | "search"
  | "export"
  | "more"
  | "minus"
  | "plus"
  | "fit"
  | "check"
  | "file"
  | "newMindMap"
  | "folder"
  | "code"
  | "undo"
  | "command"
  | "chevron"
  | "chevronDown";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  const paths: Record<IconName, React.ReactNode> = {
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.2 4.2" />
      </>
    ),
    export: (
      <>
        <path d="M12 15V3" />
        <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
        <path d="M5 13v6.5h14V13" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    minus: <path d="M5 12h14" />,
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    fit: (
      <>
        <path d="M4 9V4h5" />
        <path d="M15 4h5v5" />
        <path d="M20 15v5h-5" />
        <path d="M9 20H4v-5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    file: (
      <>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v5h5" />
      </>
    ),
    newMindMap: (
      <>
        <path d="M6 3.5h8l4 4v13H6z" />
        <path d="M14 3.5v4h4" />
        <path d="M9 13h6M12 10v6" />
      </>
    ),
    folder: <path d="M3 6.5h7l2 2h9v10.5H3z" />,
    code: (
      <>
        <path d="m8 8-4 4 4 4" />
        <path d="m16 8 4 4-4 4" />
      </>
    ),
    undo: (
      <>
        <path d="M9 7H4v-5" />
        <path d="M4.5 7.5A8 8 0 1 1 5 17" />
      </>
    ),
    command: (
      <>
        <path d="M9 8.5V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    chevronDown: <path d="m7 9.5 5 5 5-5" />,
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
