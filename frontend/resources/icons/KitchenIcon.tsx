import type { SVGProps } from 'react'
import spriteUrl from './kitchen-sprite.svg?url'

type KitchenIconProps = SVGProps<SVGSVGElement> & { name: string }

export function KitchenIcon({ name, ...props }: KitchenIconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <use href={`${spriteUrl}#${name}`} />
    </svg>
  )
}
