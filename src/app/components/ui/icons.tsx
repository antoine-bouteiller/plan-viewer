import { type SVGProps } from 'react'

// Hugeicons (stroke rounded): search-01, loading-03, arrow-right-01
const Icon = ({ children, ...props }: SVGProps<SVGSVGElement>) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    {children}
  </svg>
)

export const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M17 17L21 21" />
    <path d="M19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11Z" />
  </Icon>
)

export const LoadingIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 3V6" />
    <path d="M12 18V21" />
    <path d="M21 12L18 12" />
    <path d="M6 12L3 12" />
    <path d="M18.3635 5.63672L16.2422 7.75804" />
    <path d="M7.75804 16.2422L5.63672 18.3635" />
    <path d="M18.3635 18.3635L16.2422 16.2422" />
    <path d="M7.75804 7.75804L5.63672 5.63672" />
  </Icon>
)

export const ChevronRightIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18" />
  </Icon>
)
