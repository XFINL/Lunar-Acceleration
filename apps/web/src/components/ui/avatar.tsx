import { cn } from '@/lib/utils'

interface AvatarProps {
  name?: string | null
  src?: string | null
  className?: string
}

export function Avatar({ name, src, className }: AvatarProps) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase()
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? 'avatar'}
        className={cn('h-9 w-9 rounded-full object-cover', className)}
      />
    )
  }
  return (
    <span
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary',
        className,
      )}
    >
      {initial}
    </span>
  )
}
