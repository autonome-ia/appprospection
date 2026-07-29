import { useEffect, useState } from 'react'
import { addPointNote, deletePoint, fetchPoint, updatePoint } from '../data/points'
import { PointDetailSheet } from './PointDetailSheet'
import { AppointmentForm } from './AppointmentForm'
import type { MapPoint, Profile } from '../domain/types'
import type { Appointment } from '../domain/appointments'

// -----------------------------------------------------------------------------
// Fiche du POINT hors carte (convergence 29/07 soir — décision briac
// « identique strict » : le modal de la carte, jugé le meilleur, devient LE
// modal unique de l'app). Ouvre PointDetailSheet depuis l'Accueil, le
// planning du jour et la vue Contacts, avec des mutations par la couche data
// (la carte, elle, garde ses mises à jour optimistes via usePoints — le
// temps réel propage entre les deux). Monte aussi le formulaire RDV
// par-dessus la fiche (Modifier / Planifier / + RDV), comme MapView.
// -----------------------------------------------------------------------------

interface Props {
  pointId: string
  /** Point complet si déjà connu (vue Contacts) : ouverture instantanée. */
  initial?: MapPoint | null
  profile: Profile
  onOpenChange: (open: boolean) => void
  /** Le point ou un RDV a changé : l'écran parent recharge. */
  onChanged?: () => void
  /** « Carte » au pied de la fiche (bascule d'onglet + sélection). */
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
}

export function PointSheet({
  pointId,
  initial,
  profile,
  onOpenChange,
  onChanged,
  onShowOnMap,
}: Props) {
  const [point, setPoint] = useState<MapPoint | null>(
    initial && initial.id === pointId ? initial : null,
  )
  const [rdvTarget, setRdvTarget] = useState<{
    point: MapPoint
    existing: Appointment | null
  } | null>(null)
  const [apptsVersion, setApptsVersion] = useState(0)

  useEffect(() => {
    if (initial && initial.id === pointId) {
      setPoint(initial)
      return
    }
    setPoint(null)
    let active = true
    fetchPoint(pointId)
      .then((p) => {
        if (active) setPoint(p)
      })
      .catch((e) => console.error('Fiche du point :', e))
    return () => {
      active = false
    }
    // L'identité de l'objet `initial` peut changer au reload du parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId])

  if (!point) return null

  return (
    <>
      <PointDetailSheet
        open
        point={point}
        onOpenChange={onOpenChange}
        onShowOnMap={onShowOnMap}
        onUpdate={async (id, changes) => {
          const updated = await updatePoint(profile, id, changes)
          setPoint(updated)
          onChanged?.()
        }}
        onAddNote={async (id, body) => {
          await addPointNote(profile, id, body)
          onChanged?.()
        }}
        onDelete={async (id) => {
          await deletePoint(id)
          onChanged?.()
        }}
        onRdvNeeded={(p, existing) => setRdvTarget({ point: p, existing: existing ?? null })}
        apptsVersion={apptsVersion}
      />
      {rdvTarget && (
        <AppointmentForm
          open
          onOpenChange={(o) => !o && setRdvTarget(null)}
          profile={profile}
          // Mode ÉDITION quand la fiche a demandé un décalage (« Modifier »
          // de la section RDV) — sinon création liée au point (mêmes props
          // que MapView : la fiche reste ouverte dessous, se rafraîchit via
          // apptsVersion).
          existing={rdvTarget.existing ?? undefined}
          pointId={rdvTarget.point.id}
          coords={{ lng: rdvTarget.point.lng, lat: rdvTarget.point.lat }}
          pointNote={rdvTarget.point.note}
          defaultClientName={rdvTarget.point.client_name}
          defaultClientPhone={rdvTarget.point.client_phone}
          onSaved={() => {
            setRdvTarget(null)
            setApptsVersion((v) => v + 1)
            onChanged?.()
          }}
        />
      )}
    </>
  )
}
