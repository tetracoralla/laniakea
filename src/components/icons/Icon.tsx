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
  | "folder"
  | "code"
  | "undo"
  | "command"
  | "mindMap"
  | "flowChart"
  | "layers"
  | "chevron"
  | "chevronDown";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

// IconPark geometry supplied by Armorial under Apache-2.0.
const paths: Record<IconName, React.ReactNode> = {
  file: (
    <>
      <path d="M10 44H38C39.1046 44 40 43.1046 40 42V14H30V4H10C8.89543 4 8 4.89543 8 6V42C8 43.1046 8.89543 44 10 44Z" />
      <path d="M30 4L40 14" />
      <path d="M24 22V36" />
      <path d="M18 22H24L30 22" />
    </>
  ),
  search: (
    <>
      <path d="M21 38C30.3888 38 38 30.3888 38 21C38 11.6112 30.3888 4 21 4C11.6112 4 4 11.6112 4 21C4 30.3888 11.6112 38 21 38Z" />
      <path d="M26.657 14.3431C25.2093 12.8954 23.2093 12 21.0001 12C18.791 12 16.791 12.8954 15.3433 14.3431" />
      <path d="M33.2216 33.2217L41.7069 41.707" />
    </>
  ),
  export: (
    <>
      <path d="M42 27C42 33 38 43 24 43C10 43 6 33 6 27" />
      <path d="M24.0078 5.10059V33.0001" />
      <path d="M12 17L24 5L36 17" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="24" r="3" fill="currentColor" stroke="none" />
      <circle cx="24" cy="24" r="3" fill="currentColor" stroke="none" />
      <circle cx="36" cy="24" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  minus: <path d="M10.5 24L38.5 24" />,
  plus: (
    <>
      <path d="M24.0605 10L24.0239 38" />
      <path d="M10 24L38 24" />
    </>
  ),
  fit: (
    <>
      <path d="M33 6H42V15" />
      <path d="M42 33V42H33" />
      <path d="M15 42H6V33" />
      <path d="M6 15V6H15" />
    </>
  ),
  check: <path d="M43 11L16.875 37L5 25.1818" />,
  folder: (
    <>
      <path d="M5 8C5 6.89543 5.89543 6 7 6H19L24 12H41C42.1046 12 43 12.8954 43 14V40C43 41.1046 42.1046 42 41 42H7C5.89543 42 5 41.1046 5 40V8Z" />
      <path d="M43 22H5" />
      <path d="M5 16V28" />
      <path d="M43 16V28" />
    </>
  ),
  code: (
    <>
      <path d="M16 13L4 25.4322L16 37" />
      <path d="M32 13L44 25.4322L32 37" />
      <path d="M28 4L21 44" />
    </>
  ),
  undo: (
    <>
      <path d="M11.2721 36.7279C14.5294 39.9853 19.0294 42 24 42C33.9411 42 42 33.9411 42 24C42 14.0589 33.9411 6 24 6C19.0294 6 14.5294 8.01472 11.2721 11.2721C9.61407 12.9301 6 17 6 17" />
      <path d="M6 9V17H14" />
    </>
  ),
  command: (
    <>
      <path d="M9.45455 14.9091C10.5023 14.9091 12.3205 14.9091 14.9091 14.9091C14.9091 12.2333 14.9091 10.4151 14.9091 9.45455C14.9091 6.44208 12.467 4 9.45455 4C6.44208 4 4 6.44208 4 9.45455C4 12.467 6.44208 14.9091 9.45455 14.9091Z" />
      <path d="M9.45455 33.0909H14.9091V38.5454C14.9091 41.5579 12.467 44 9.45455 44C6.44208 44 4 41.5579 4 38.5454C4 35.533 6.44208 33.0909 9.45455 33.0909Z" />
      <rect x="14.9092" y="14.9091" width="18.1818" height="18.1818" />
      <path d="M38.5454 14.9091H33.0908V9.45455C33.0908 6.44208 35.5329 4 38.5454 4C41.5578 4 43.9999 6.44208 43.9999 9.45455C43.9999 12.467 41.5578 14.9091 38.5454 14.9091Z" />
      <path d="M38.5454 33.0909C41.5578 33.0909 43.9999 35.533 43.9999 38.5454C43.9999 41.5579 41.5578 44 38.5454 44C35.5329 44 33.0908 41.5579 33.0908 38.5454V33.0909H38.5454Z" />
    </>
  ),
  mindMap: (
    <>
      <path d="M8 28C10.2091 28 12 26.2091 12 24C12 21.7909 10.2091 20 8 20C5.79086 20 4 21.7909 4 24C4 26.2091 5.79086 28 8 28Z" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M42 8C43.1046 8 44 7.10457 44 6C44 4.89543 43.1046 4 42 4C40.8954 4 40 4.89543 40 6C40 7.10457 40.8954 8 42 8Z" strokeWidth={2} />
      <path d="M42 26C43.1046 26 44 25.1046 44 24C44 22.8954 43.1046 22 42 22C40.8954 22 40 22.8954 40 24C40 25.1046 40.8954 26 42 26Z" strokeWidth={2} />
      <path d="M42 44C43.1046 44 44 43.1046 44 42C44 40.8954 43.1046 40 42 40C40.8954 40 40 40.8954 40 42C40 43.1046 40.8954 44 42 44Z" strokeWidth={2} />
      <path d="M32 6H20V42H32" strokeWidth={2} />
      <path d="M12 24H32" strokeWidth={2} />
    </>
  ),
  flowChart: (
    <>
      <rect x="17" y="6" width="14" height="9" fill="none" stroke="currentColor" strokeWidth={2} />
      <rect x="6" y="33" width="14" height="9" fill="none" stroke="currentColor" strokeWidth={2} />
      <rect x="28" y="33" width="14" height="9" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M24 16V24" strokeWidth={2} />
      <path d="M13 33V24H35V33" strokeWidth={2} />
    </>
  ),
  layers: (
    <>
      <path d="M4 11.9143L24 19L44 11.9143L24 5L4 11.9143Z" fill="none" strokeWidth={3} />
      <path d="M4 20L24 27L44 20" strokeWidth={3} />
      <path d="M4 28L24 35L44 28" strokeWidth={3} />
      <path d="M4 36L24 43L44 36" strokeWidth={3} />
    </>
  ),
  chevron: <path d="M19 12L31 24L19 36" />,
  chevronDown: <path d="M36 18L24 30L12 18" />,
};

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 48 48"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="4"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
