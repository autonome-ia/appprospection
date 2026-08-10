import { useEffect, useState } from 'react'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
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

// Codes WMO (doc Open-Meteo) → icône Lucide + libellé (title/aria).
function meta(code: number, isDay: boolean): { Icon: LucideIcon; label: string } {
  if (code === 0) return isDay ? { Icon: Sun, label: 'Ciel dégagé' } : { Icon: Moon, label: 'Nuit claire' }
  if (code <= 2) return isDay ? { Icon: CloudSun, label: 'Éclaircies' } : { Icon: CloudMoon, label: 'Éclaircies' }
  if (code === 3) return { Icon: Cloud, label: 'Couvert' }
  if (code === 45 || code === 48) return { Icon: CloudFog, label: 'Brouillard' }
  if (code <= 57) return { Icon: CloudDrizzle, label: 'Bruine' }
  if (code <= 67) return { Icon: CloudRain, label: 'Pluie' }
  if (code <= 77) return { Icon: CloudSnow, label: 'Neige' }
  if (code <= 82) return { Icon: CloudRain, label: 'Averses' }
  if (code <= 86) return { Icon: CloudSnow, label: 'Averses de neige' }
  return { Icon: CloudLightning, label: 'Orage' }
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
  const { Icon, label } = meta(w.code, w.isDay)
  return (
    <span
      className={`weather-chip${className ? ` ${className}` : ''}`}
      title={`${label} — données Open-Meteo`}
      aria-label={`Météo : ${label}, ${Math.round(w.temp)} degrés`}
    >
      <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
      <span className="tnum">{Math.round(w.temp)}°</span>
    </span>
  )
}
