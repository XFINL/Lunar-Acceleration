import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import LiquidGlass from 'liquid-glass-react'
import { cn } from '@/lib/utils'
import './glass-surface.css'

interface GlassPreferences {
  effects: boolean
  overLight: boolean
}
const GlassContext = createContext<GlassPreferences>({ effects: false, overLight: true })
const STILL_POINTER = Object.freeze({ x: 0, y: 0 })
const PREFERENCE_QUERIES = [
  '(prefers-reduced-motion: reduce)',
  '(prefers-reduced-transparency: reduce)',
  '(forced-colors: active)',
  '(pointer: coarse)',
]

function readPreferences(): GlassPreferences {
  if (typeof window === 'undefined') return { effects: false, overLight: true }
  const backdropSupported = typeof CSS !== 'undefined' && (
    CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
  )
  return {
    effects: backdropSupported && !PREFERENCE_QUERIES.some(query => window.matchMedia(query).matches),
    overLight: !document.documentElement.classList.contains('dark'),
  }
}

/** One preference observer for the entire app, not one listener per control. */
export function GlassPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<GlassPreferences>(readPreferences)
  useEffect(() => {
    const update = () => {
      const next = readPreferences()
      setPreferences(current => current.effects === next.effects && current.overLight === next.overLight ? current : next)
    }
    const media = PREFERENCE_QUERIES.map(query => window.matchMedia(query))
    media.forEach(query => query.addEventListener('change', update))
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    update()
    return () => {
      media.forEach(query => query.removeEventListener('change', update))
      observer.disconnect()
    }
  }, [])
  return <GlassContext.Provider value={preferences}>{children}</GlassContext.Provider>
}

function GlassBackdrop({ radius, overLight }: { radius: number; overLight: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const measure = () => {
      const bounds = layer.getBoundingClientRect()
      const width = Math.round(bounds.width)
      const height = Math.round(bounds.height)
      setSize(current => current.width === width && current.height === height ? current : { width, height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(layer)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={layerRef} data-liquid-glass-layer="" aria-hidden="true">
      {size.width > 0 && size.height > 0 && (
        <LiquidGlass
          // The upstream library only measures on mount/window resize. Recreate the
          // decorative layer when async tables/dialog content changes size.
          key={`${size.width}:${size.height}`}
          className="lunar-liquid-effect"
          style={{ position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%' }}
          padding="0"
          cornerRadius={radius}
          displacementScale={26}
          blurAmount={0.18}
          saturation={0}
          aberrationIntensity={0}
          elasticity={0}
          overLight={overLight}
          mode="standard"
          globalMousePos={STILL_POINTER}
          mouseOffset={STILL_POINTER}
        >
          <span />
        </LiquidGlass>
      )}
    </div>
  )
}

export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  radius?: number
  variant?: 'frosted' | 'liquid'
}

/** CSS-only by default. SVG refraction is opt-in and reserved for navigation. */
export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(
  ({ children, className, radius = 24, variant = 'frosted', ...props }, ref) => {
    const preferences = useContext(GlassContext)
    const enhanced = variant === 'liquid' && preferences.effects
    return (
      <div
        ref={ref}
        className={cn('relative isolate frosted-panel glass-surface', className)}
        data-glass-variant={variant}
        data-glass-enhanced={enhanced ? 'true' : 'false'}
        {...props}
      >
        {enhanced && <GlassBackdrop radius={radius} overLight={preferences.overLight} />}
        {children}
      </div>
    )
  },
)
GlassSurface.displayName = 'GlassSurface'
