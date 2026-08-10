import { useEffect, useState } from 'react'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { getWeather, type Weather } from '../data/weather'

// symbol_code met.no (41 familles × suffixe _day/_night) → icône Lucide +
// libellé. On teste du plus spécifique (orage) au plus général (dégagé).
function meta(symbol: string): { Icon: LucideIcon; label: string } {
  const day = !symbol.endsWith('_night')
  const base = symbol.replace(/_(day|night|polartwilight)$/, '')
  if (base.includes('thunder')) return { Icon: CloudLightning, label: 'Orage' }
  if (base.includes('sleet')) return { Icon: CloudHail, label: 'Grésil' }
  if (base.includes('snow')) return { Icon: CloudSnow, label: 'Neige' }
  if (base.startsWith('lightrain')) return { Icon: CloudDrizzle, label: 'Pluie faible' }
  if (base.includes('rainshowers')) return { Icon: CloudRain, label: 'Averses' }
  if (base.includes('rain')) return { Icon: CloudRain, label: 'Pluie' }
  if (base === 'fog') return { Icon: CloudFog, label: 'Brouillard' }
  if (base === 'cloudy') return { Icon: Cloud, label: 'Couvert' }
  if (base === 'partlycloudy' || base === 'fair')
    return day ? { Icon: CloudSun, label: 'Éclaircies' } : { Icon: CloudMoon, label: 'Éclaircies' }
  return day ? { Icon: Sun, label: 'Ciel dégagé' } : { Icon: Moon, label: 'Nuit claire' }
}

/** Température + condition à la position du commercial. Rien tant que la
 *  météo n'est pas là (et jamais rien si géoloc refusée ou API muette). */
export function WeatherChip({ className }: { className?: string }) {
  const [w, setW] = useState<Weather | null>(null)
  useEffect(() => {
    let on = true
    getWeather().then((d) => on && setW(d))
    return () => {
      on = false
    }
  }, [])
  if (!w) return null
  const { Icon, label } = meta(w.symbol)
  return (
    <span
      className={`weather-chip${className ? ` ${className}` : ''}`}
      title={`${label} — données MET Norway (CC BY 4.0)`}
      aria-label={`Météo : ${label}, ${Math.round(w.temp)} degrés`}
    >
      <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
      <span className="tnum">{Math.round(w.temp)}°</span>
    </span>
  )
}
