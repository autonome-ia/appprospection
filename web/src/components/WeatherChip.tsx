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
// libellé + teinte (classe w-*). On teste du plus spécifique (orage) au plus
// général (dégagé).
function meta(symbol: string): { Icon: LucideIcon; label: string; tone: string } {
  const day = !symbol.endsWith('_night')
  const base = symbol.replace(/_(day|night|polartwilight)$/, '')
  if (base.includes('thunder')) return { Icon: CloudLightning, label: 'Orage', tone: 'orage' }
  if (base.includes('sleet')) return { Icon: CloudHail, label: 'Grésil', tone: 'neige' }
  if (base.includes('snow')) return { Icon: CloudSnow, label: 'Neige', tone: 'neige' }
  if (base.startsWith('lightrain')) return { Icon: CloudDrizzle, label: 'Pluie faible', tone: 'pluie' }
  if (base.includes('rainshowers')) return { Icon: CloudRain, label: 'Averses', tone: 'pluie' }
  if (base.includes('rain')) return { Icon: CloudRain, label: 'Pluie', tone: 'pluie' }
  if (base === 'fog') return { Icon: CloudFog, label: 'Brouillard', tone: 'nuage' }
  if (base === 'cloudy') return { Icon: Cloud, label: 'Couvert', tone: 'nuage' }
  if (base === 'partlycloudy' || base === 'fair')
    return day
      ? { Icon: CloudSun, label: 'Éclaircies', tone: 'soleil' }
      : { Icon: CloudMoon, label: 'Éclaircies', tone: 'lune' }
  return day
    ? { Icon: Sun, label: 'Ciel dégagé', tone: 'soleil' }
    : { Icon: Moon, label: 'Nuit claire', tone: 'lune' }
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
  const { Icon, label, tone } = meta(w.symbol)
  return (
    <span
      className={`weather-chip${className ? ` ${className}` : ''}`}
      title={`${label} — données MET Norway (CC BY 4.0)`}
      aria-label={`Météo : ${label}, ${Math.round(w.temp)} degrés`}
    >
      <Icon size={15} strokeWidth={1.9} className={`w-${tone}`} aria-hidden="true" />
      <span className="tnum">{Math.round(w.temp)}°</span>
    </span>
  )
}
