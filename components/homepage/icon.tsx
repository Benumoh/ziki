export type IconName =
  | 'arrow'
  | 'bolt'
  | 'check'
  | 'chevron'
  | 'code'
  | 'eye'
  | 'git'
  | 'menu'
  | 'shield'
  | 'spark'
  | 'target'
  | 'x'

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    bolt: <path d="m13 2-8 11h7l-1 9 8-12h-7l1-8Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    code: <><path d="m8 9-4 3 4 3" /><path d="m16 9 4 3-4 3" /><path d="m14 5-4 14" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
    git: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M8 7c2 0 3 1 3 3v1c0 2 1 3 3 3h2" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 7.5 7.5 9.5 4.3-2 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></>,
    spark: <><path d="m12 2 1.4 4.1L18 8l-4.6 1.9L12 14l-1.4-4.1L6 8l4.6-1.9L12 2Z" /><path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M14.5 9.5 20 4" /></>,
    x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  }

  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{paths[name]}</g>
    </svg>
  )
}
