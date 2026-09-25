import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '../ui/Avatar'
import { FormGroup, FormRow } from '../ui/Form'
import type { OrgProfile } from '../../data/profiles'
import {
  fetchAgencyRates,
  fetchProfileRates,
  setAgencyRate,
  setCanEditSales,
  setMonthlyCaTarget,
  setProfileRate,
  useNumbersAccess,
  type RateTable,
} from '../../data/sales'
import { PRESTATIONS, formatEuros, type Prestation } from '../../domain/sales'
import { roleLabel, type Profile } from '../../domain/types'

/** « 13 » ou « 12,5 » (en %) → 0.13 ; null si vide ou invalide. */
function parsePct(raw: string): number | null {
  const t = raw.replace(',', '.').replace('%', '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 10000 : null
}
const showPct = (r: number | undefined) => (r == null ? '' : String(Math.round(r * 10000) / 100).replace('.', ','))

/** Champ de taux : enregistré à la sortie du champ, s'il a changé. */
function RateInput({
  value,
  placeholder,
  onCommit,
  disabled,
}: {
  value: number | undefined
  placeholder?: string
  onCommit: (rate: number | null) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(showPct(value))
  useEffect(() => setText(showPct(value)), [value])
  return (
    <span className="rate-input">
      <input
        className="form-input tnum"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text === showPct(value)) return
          const r = parsePct(text)
          if (text.trim() && r == null) {
            toast.error('Taux invalide : entre 0 et 100')
            setText(showPct(value))
            return
          }
          onCommit(r)
        }}
      />
      <span className="rate-unit">%</span>
    </span>
  )
}

/**
 * Réglages Numbers du manager, dans l'écran Équipe (plan §4.4) : taux de
 * l'agence, et par membre l'objectif de CA mensuel, ses taux propres et,
 * pour un chef des ventes, le droit de modifier les ventes. Composant à
 * part : l'écran Équipe n'en reçoit qu'une ligne (fusion avec `site`).
 * La base a le dernier mot (profiles_numbers_guard, RLS des taux).
 */
export function NumbersTeamSection({
  profile,
  members,
  onChanged,
}: {
  profile: Profile
  members: OrgProfile[]
  onChanged: () => void
}) {
  const on = useNumbersAccess(profile)
  const [agency, setAgency] = useState<RateTable>({})
  const [perProfile, setPerProfile] = useState<Record<string, RateTable>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadRates = () =>
    Promise.all([fetchAgencyRates(), fetchProfileRates()])
      .then(([a, p]) => {
        setAgency(a)
        setPerProfile(p)
      })
      .catch((e) => console.error('Taux Numbers :', e))

  useEffect(() => {
    if (on) void loadRates()
  }, [on])

  if (!on || profile.role !== 'manager') return null

  const run = async (label: string, fn: () => Promise<void>, after: () => void) => {
    setBusy(true)
    try {
      await fn()
      after()
      toast.success(label)
    } catch (e) {
      console.error('Réglage Numbers :', e)
      toast.error('Réglage refusé : réseau, ou droits insuffisants')
    } finally {
      setBusy(false)
    }
  }

  const sellers = members.filter((m) => !m.disabled_at && m.role !== 'secretaire' && !m.is_support)

  return (
    <>
      <p className="eyebrow section-title">Numbers</p>
      <FormGroup title="Taux de commission de l’agence" hint="S’applique aux nouvelles ventes : une vente garde le taux du jour où elle est faite.">
        {PRESTATIONS.map((x) => (
          <FormRow key={x.value} label={x.label}>
            <RateInput
              value={agency[x.value]}
              disabled={busy}
              onCommit={(r) => {
                if (r == null) return
                void run(`Taux ${x.label.toLowerCase()} : ${showPct(r)} %`, () => setAgencyRate(profile.organization_id, x.value, r), loadRates)
              }}
            />
          </FormRow>
        ))}
      </FormGroup>

      {sellers.map((m) => {
        const expanded = openId === m.id
        const own = perProfile[m.id] ?? {}
        const custom = Object.keys(own).length
        return (
          <div key={m.id} className="team-member">
            <button type="button" className="team-row" onClick={() => setOpenId(expanded ? null : m.id)}>
              <Avatar id={m.id} name={m.full_name} color={m.color} size={34} className="team-avatar" />
              <span className="team-texts">
                <span className="team-name">{m.full_name ?? 'Sans nom'}</span>
                <span className="team-role">
                  {roleLabel(m.role)} · objectif{' '}
                  <span className="tnum">{m.monthly_ca_target > 0 ? formatEuros(m.monthly_ca_target) : 'aucun'}</span>
                  {custom > 0 && ` · ${custom} taux propre${custom > 1 ? 's' : ''}`}
                </span>
              </span>
            </button>
            {expanded && (
              <div className="team-panel">
                <TargetField
                  member={m}
                  disabled={busy}
                  onCommit={(v) => void run('Objectif de CA enregistré', () => setMonthlyCaTarget(m.id, v), onChanged)}
                />
                <FormGroup title="Taux de commission" hint="Vide : taux de l’agence.">
                  {PRESTATIONS.map((x) => (
                    <FormRow key={x.value} label={x.label}>
                      <RateInput
                        value={own[x.value as Prestation]}
                        placeholder={showPct(agency[x.value])}
                        disabled={busy}
                        onCommit={(r) =>
                          void run(
                            r == null ? 'Retour au taux de l’agence' : `Taux propre : ${showPct(r)} %`,
                            () => setProfileRate(profile.organization_id, m.id, x.value, r),
                            loadRates,
                          )
                        }
                      />
                    </FormRow>
                  ))}
                </FormGroup>
                {m.role === 'chef_ventes' && (
                  <button
                    type="button"
                    className={`team-check ${m.can_edit_sales ? 'is-on' : ''}`}
                    onClick={() =>
                      void run(
                        m.can_edit_sales ? 'Droit de modification retiré' : 'Droit de modification accordé',
                        () => setCanEditSales(m.id, !m.can_edit_sales),
                        onChanged,
                      )
                    }
                    disabled={busy}
                    role="switch"
                    aria-checked={m.can_edit_sales}
                  >
                    <span className="team-check-texts">
                      <span className="team-check-label">Peut modifier les ventes</span>
                      <span className="team-check-hint">Sinon, lecture seule sur les ventes de l’équipe.</span>
                    </span>
                    <span className="switch" aria-hidden="true">
                      <span className="switch-thumb" />
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function TargetField({
  member,
  disabled,
  onCommit,
}: {
  member: OrgProfile
  disabled: boolean
  onCommit: (v: number) => void
}) {
  const show = (n: number) => (n > 0 ? String(n) : '')
  const [text, setText] = useState(show(member.monthly_ca_target))
  useEffect(() => setText(show(member.monthly_ca_target)), [member.monthly_ca_target])
  return (
    <FormGroup title="Objectif de CA mensuel" hint="Le même chaque mois. Vide ou 0 : pas d’objectif.">
      <FormRow label="Objectif HT">
        <span className="rate-input">
          <input
            className="form-input tnum"
            inputMode="numeric"
            placeholder="0"
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => {
              const v = Number(text || 0)
              if (v !== member.monthly_ca_target) onCommit(v)
            }}
          />
          <span className="rate-unit">€</span>
        </span>
      </FormRow>
    </FormGroup>
  )
}
