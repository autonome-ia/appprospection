// Préparation d'une image avant envoi (photo de profil, logo — 24/09) :
// recadrage CARRÉ centré puis réduction à `size` px, sur le téléphone. Une
// photo iPhone de 3-4 Mo devient ~30 Ko : envoi instantané même en 4G.
// JPEG pour les photos (Safari iOS n'encode pas le WebP), PNG pour les
// logos (transparence conservée).

export async function squareImage(
  file: File,
  {
    size = 256,
    type = 'image/jpeg',
    contain = false,
  }: { size?: number; type?: 'image/jpeg' | 'image/png'; contain?: boolean } = {},
): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff' // pas de transparence en JPEG : fond blanc
    ctx.fillRect(0, 0, size, size)
  }
  // Photo : on REMPLIT le carré (cover, le centre est gardé). Logo : on le
  // fait TENIR entier dans le carré (contain), sans rogner les bords.
  const scale = contain
    ? Math.min(size / bmp.width, size / bmp.height)
    : Math.max(size / bmp.width, size / bmp.height)
  const w = bmp.width * scale
  const h = bmp.height * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h)
  bmp.close()
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encodage impossible'))), type, 0.86),
  )
}
