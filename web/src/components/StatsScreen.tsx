import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { fetchStats, ratio, type Period, type CommercialStats } from '../data/stats'
import { fetchOrgProfiles, updateWeeklyTarget, type OrgProfile } from '../data/profiles'
import { colorForCommercial } from '../domain/colors'
import type { Profile } from '../domain/types'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'jour', label: 'Jour' },
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
]

const pct = (r: number) => `${Math.round(r * 100)}%`

const FUNNEL: { key: keyof CommercialStats; label: string; color: string }[] = [
  { key: 'portes', label: 'Portes', color: '#98a2b3' },
  { key: 'contacts', label: 'Contacts', color: '#7aa5f0' },
  { key: 'rdv_pris', label: 'RDV pris', color: '#2f6bff' },
  { key: 'rdv_effectues', label: 'RDV effectués', color: '#12b3a6' },
  { key: 'ventes', label: 'Ventes', color: '#17b26a' },
]

function FunnelRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const width = max > 0 ? Math.max(3, (value / max) * 100) : 0
  return (
    <div className="funnel-row">
      <span className="funnel-label">{label}</span>
      <div className="funnel-bar-bg">
        <motion.div
          className="funnel-bar"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="funnel-value tnum">{value}</span>
    </div>
  )
}

function Ratio({ label, value }: { label: string; value: number }) {
  return (
    <div className="ratio-cell">
      <span className="ratio-value tnum">{pct(value)}</span>
      <span className="ratio-label">{label}</span>
    </div>
  )
}

export function StatsScreen({ profile }: { profile: Profile | null }) {
  const [period, setPeriod] = useState<Period>('semaine')
  const [stats, setStats] = useState<Record<string, CommercialStats>>({})
  const [team, setTeam] = useState<CommercialStats | null>(null)
  const [profiles, setProfiles] = useState<OrgProfile[]>([])

  const isManager = profile?.role === 'manager'

  const loadProfiles = useCallback(() => {
    fetchOrgProfiles().then(setProfiles).catch((e) => console.error('Profils :', e))
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  useEffect(() => {
    fetchStats(period)
      .then((r) => {
        setStats(r.byCommercial)
        setTeam(r.team)
      })
      .catch((e) => console.error('Stats :', e))
  }, [period])

  if (!profile) return <div className="placeholder">Connexion requise.</div>

  const ranked = [...profiles].sort((a, b) => {
    const sa = stats[a.id] ?? { ventes: 0, rdv_pris: 0 }
    const sb = stats[b.id] ?? { ventes: 0, rdv_pris: 0 }
    return sb.ventes - sa.ventes || sb.rdv_pris - sa.rdv_pris
  })
  const max = team?.portes ?? 0

  return (
    <div className="screen">
      <header className="screen-head">
        <h2>Statistiques</h2>
      </header>

      <div className="seg">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`seg-btn ${period === p.value ? 'is-active' : ''}`}
            onClick={() => setPeriod(p.value)}
          >
            {period === p.value && (
              <motion.span
                layoutId="seg-indicator"
                className="seg-ind"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="seg-text">{p.label}</span>
          </button>
        ))}
      </div>

      {team && (
        <section className="card">
          <p className="eyebrow">Tunnel de conversion · Équipe</p>
          <div className="funnel">
            {FUNNEL.map((f) => (
              <FunnelRow key={f.key} label={f.label} value={team[f.key] as number} max={max} color={f.color} />
            ))}
          </div>
          <div className="ratios">
            <Ratio label="Contact" value={ratio(team.contacts, team.portes)} />
            <Ratio label="Prise RDV" value={ratio(team.rdv_pris, team.contacts)} />
            <Ratio label="Présence" value={ratio(team.rdv_effectues, team.rdv_pris)} />
            <Ratio label="Transfo" value={ratio(team.ventes, team.rdv_effectues)} />
            <Ratio label="Conv." value={ratio(team.ventes, team.portes)} />
          </div>
        </section>
      )}

      <section className="card">
        <p className="eyebrow">Classement des commerciaux</p>
        {ranked.length === 0 && <p className="screen-empty">Aucun commercial.</p>}
        {ranked.map((p, i) => {
          const s = stats[p.id] ?? { portes: 0, contacts: 0, rdv_pris: 0, rdv_effectues: 0, ventes: 0 }
          const target = p.weekly_rdv_target || 0
          const targetPct = target > 0 ? Math.min(100, (s.rdv_pris / target) * 100) : 0
          return (
            <div key={p.id} className="rank">
              <span className="rank-pos tnum">{i + 1}</span>
              <span className="status-dot" style={{ background: colorForCommercial(p.id, p.color) }} />
              <div className="rank-body">
                <div className="rank-line">
                  <span className="rank-name">{p.full_name ?? 'Commercial'}</span>
                  <span className="rank-sales tnum">
                    {s.ventes} <span className="rank-sales-unit">vente{s.ventes > 1 ? 's' : ''}</span>
                  </span>
                </div>
                <div className="rank-metrics tnum">
                  {s.portes} portes · {s.rdv_pris} RDV · {s.rdv_effectues} eff. · Transfo{' '}
                  {pct(ratio(s.ventes, s.rdv_effectues))}
                </div>
                <div className="rank-obj">
                  <div className="obj-bar-bg">
                    <div className="obj-bar" style={{ width: `${targetPct}%` }} />
                  </div>
                  <span className="obj-text tnum">
                    {s.rdv_pris}/{target}
                  </span>
                  {isManager && (
                    <input
                      className="obj-input tnum"
                      type="number"
                      min={0}
                      defaultValue={target}
                      title="Objectif hebdomadaire de RDV"
                      onBlur={async (e) => {
                        const v = parseInt(e.target.value, 10)
                        if (!Number.isNaN(v) && v !== target) {
                          await updateWeeklyTarget(p.id, v)
                          loadProfiles()
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </section>

      <p className="stats-note">Un « contact » = à revoir / RDV pris / vendu. À ajuster selon le métier.</p>
    </div>
  )
}
