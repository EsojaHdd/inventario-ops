import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { createClient } from 'redis'
import { createServer } from 'http'
import pkg from 'pg'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import * as xlsx from 'xlsx'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { Pool } = pkg
const app    = express()
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// ── PostgreSQL ─────────────────────────────────────────────
const db = new Pool({ connectionString: process.env.DATABASE_URL })

// ── Redis ──────────────────────────────────────────────────
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' })
redis.on('error', err => console.error('Redis error:', err))
await redis.connect()
console.log('✅ Redis conectado')

// ── WebSocket ──────────────────────────────────────────────
const wss       = new WebSocketServer({ port: process.env.WS_PORT || 3001 })
const wsClients = new Set()
wss.on('connection', ws => {
  wsClients.add(ws)
  ws.on('close', () => wsClients.delete(ws))
  ws.on('error', () => wsClients.delete(ws))
})
function broadcast(data) {
  const msg = JSON.stringify(data)
  wsClients.forEach(ws => { if (ws.readyState === 1) ws.send(msg) })
}

// ── Auth ───────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'

function authMiddleware(roles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return res.status(401).json({ error: 'No autorizado' })
    try {
      const payload = jwt.verify(token, JWT_SECRET)
      if (roles.length && !roles.includes(payload.rol))
        return res.status(403).json({ error: 'Sin permisos' })
      req.user = payload
      next()
    } catch {
      return res.status(401).json({ error: 'Token inválido' })
    }
  }
}

// ── Seed admin ─────────────────────────────────────────────
async function seedAdmin() {
  const r = await db.query("SELECT id FROM usuarios WHERE username='admin'")
  if (!r.rows.length) {
    const hash = await bcrypt.hash('admin123', 10)
    await db.query("INSERT INTO usuarios (username,password_hash,rol) VALUES ('admin',$1,'admin')", [hash])
    console.log('✅ Usuario admin creado (admin/admin123)')
  }
}
await seedAdmin()
console.log('✅ Backend en puerto 3000')

// ── Helpers ────────────────────────────────────────────────
async function getOrCreateDia(fecha) {
  const f  = fecha || new Date().toISOString().split('T')[0]
  const ex = await db.query('SELECT * FROM dias_operacion WHERE fecha = $1', [f])
  if (ex.rows.length) return ex.rows[0]
  const cr = await db.query('INSERT INTO dias_operacion (fecha) VALUES ($1) RETURNING *', [f])
  return cr.rows[0]
}

function parseFile(buffer, filename) {
  const ext = filename.split('.').pop().toLowerCase()
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = xlsx.read(buffer, { type: 'buffer' })
    const sheetName = wb.SheetNames.find(n => !n.toUpperCase().includes('INSTRUC')) || wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const range = xlsx.utils.decode_range(ws['!ref'] || 'A1:Z100')
    let headerRow = 0
    const GUIA_KEYS = ['GUIA','guia','Guia','NÚMERO GUÍA','NUMERO_GUIA','numero_guia']
    for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[xlsx.utils.encode_cell({ r, c })]
        if (cell && GUIA_KEYS.includes(String(cell.v).trim())) { headerRow = r; break }
      }
      if (headerRow === r && headerRow > 0) break
    }
    return xlsx.utils.sheet_to_json(ws, { defval: '', range: headerRow })
  }
  if (ext === 'csv')
    return parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true })
  return buffer.toString('utf-8').split('\n').map(l => l.trim()).filter(Boolean).map(l => ({ GUIA: l }))
}

const COL = {
  guia:        ['GUIA','guia','numero_guia','NUMERO_GUIA'],
  master:      ['MASTER','master'],
  pza:         ['PZA','pza','bultos','BULTOS'],
  destino:     ['DESTINO','destino'],
  remitente:   ['REMITENTE','remitente'],
  cliente:     ['CLIENTE (DESTINATARIO)','cliente','CLIENTE'],
  descripcion: ['DESCRIPCION','descripcion'],
  proceso:     ['PROCESO','proceso'],
}
const col = (row, keys) => { for (const k of keys) if (row[k] !== undefined) return String(row[k]).trim(); return null }

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Faltan datos' })
  const r = await db.query('SELECT * FROM usuarios WHERE username=$1 AND activo=true', [username])
  if (!r.rows.length) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' })
  const user = r.rows[0]
  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' })
  const token = jwt.sign({ id: user.id, username: user.username, rol: user.rol }, JWT_SECRET, { expiresIn: '12h' })
  res.json({ token, user: { id: user.id, username: user.username, rol: user.rol } })
})

// ═══════════════════════════════════════════════════════════
// ESCANEO PRINCIPAL
// ═══════════════════════════════════════════════════════════

app.post('/api/scan', authMiddleware(), async (req, res) => {
  const { barcode, source = 'http', mode = 'escaneo', ubicacion, tipo_transito } = req.body
  if (!barcode) return res.status(400).json({ error: 'barcode requerido' })

  const ts    = new Date()
  const fecha = ts.toISOString().split('T')[0]
  const dia   = await getOrCreateDia(fecha)

  const guiaR = await db.query(
    `SELECT g.*, u.codigo as ubicacion_codigo, d.fecha as dia_fecha
     FROM guias g
     LEFT JOIN ubicaciones u ON g.ubicacion_id = u.id
     JOIN dias_operacion d ON g.dia_id = d.id
     WHERE g.numero_guia = $1
     ORDER BY d.fecha DESC LIMIT 1`,
    [barcode.trim()]
  )

  let guia, status

  if (!guiaR.rows.length) {
    const ins = await db.query(
      `INSERT INTO guias (dia_id, numero_guia, estatus)
       VALUES ($1, $2, 'desconocida')
       ON CONFLICT (dia_id, numero_guia) DO UPDATE SET updated_at=NOW()
       RETURNING *, (SELECT codigo FROM ubicaciones WHERE id=guias.ubicacion_id) as ubicacion_codigo`,
      [dia.id, barcode.trim()]
    )
    guia   = ins.rows[0]
    status = 'desconocida'
  } else {
    guia   = guiaR.rows[0]
    status = guia.estatus
  }

  if (mode === 'transito' && tipo_transito && guia.estatus === 'escaneada') {
    const nuevoEstatus = tipo_transito === 'local' ? 'transito_local' : 'transito_mty'
    await db.query(
      `UPDATE guias SET estatus=$1::estatus_guia, tipo_transito=$2, ultimo_escaneo=$3 WHERE id=$4`,
      [nuevoEstatus, tipo_transito, ts, guia.id]
    )
    await db.query(
      `INSERT INTO escaneos (guia_id, usuario_id, tipo, detalle, barcode_raw, dispositivo, scanned_at)
       VALUES ($1,$2,'transito',$3,$4,$5,$6)`,
      [guia.id, req.user.id, tipo_transito, barcode.trim(), source, ts]
    )
    const fresh = await db.query(
      'SELECT g.*, u.codigo as ubicacion_codigo FROM guias g LEFT JOIN ubicaciones u ON g.ubicacion_id=u.id WHERE g.id=$1',
      [guia.id]
    )
    guia   = fresh.rows[0]
    status = guia.estatus
  } else if (mode === 'escaneo') {
    let ubicIdEstacion = null
    if (ubicacion) {
      const ubicR = await db.query('SELECT id FROM ubicaciones WHERE codigo=$1 AND activa=true', [ubicacion.toUpperCase()])
      if (ubicR.rows.length) ubicIdEstacion = ubicR.rows[0].id
    }
    await db.query(
      `UPDATE guias SET
         bultos_escaneados = LEAST(bultos_escaneados+1, total_bultos),
         ultimo_escaneo    = $1,
         ubicacion_id      = COALESCE($3, ubicacion_id),
         estatus           = CASE
           WHEN estatus='pendiente'::estatus_guia THEN 'escaneada'::estatus_guia
           ELSE estatus
         END
       WHERE id=$2`,
      [ts, guia.id, ubicIdEstacion]
    )
    await db.query(
      `INSERT INTO escaneos (guia_id, usuario_id, ubicacion_id, tipo, barcode_raw, dispositivo, scanned_at)
       VALUES ($1,$2,$3,'escaneo',$4,$5,$6)`,
      [guia.id, req.user.id, ubicIdEstacion, barcode.trim(), source, ts]
    )
    const fresh = await db.query(
      'SELECT g.*, u.codigo as ubicacion_codigo FROM guias g LEFT JOIN ubicaciones u ON g.ubicacion_id=u.id WHERE g.id=$1',
      [guia.id]
    )
    guia   = fresh.rows[0]
    status = guia.estatus
  } else if (mode === 'consulta') {
    await db.query(
      `INSERT INTO escaneos (guia_id, usuario_id, tipo, barcode_raw, dispositivo, scanned_at)
       VALUES ($1,$2,'consulta',$3,$4,$5)`,
      [guia.id, req.user.id, barcode.trim(), source, ts]
    )
  }

  // Obtener PIDs si los tiene
  const pidsR = await db.query(
    'SELECT pid, escaneado FROM pids WHERE guia_id=$1 ORDER BY created_at',
    [guia.id]
  )

  const scanRecord = {
    type: 'scan', barcode: barcode.trim(), status,
    guia_id:          guia.id,
    ubicacion:        guia.ubicacion_codigo || null,
    destino:          guia.destino,
    cliente:          guia.cliente,
    proceso:          guia.proceso,
    tipo_transito:    guia.tipo_transito,
    total_bultos:     guia.total_bultos,
    bultos_escaneados:guia.bultos_escaneados,
    pids:             pidsR.rows,
    timestamp:        ts.toISOString(),
    source, mode
  }

  await redis.lPush('scans:history', JSON.stringify(scanRecord))
  await redis.lTrim('scans:history', 0, 499)
  broadcast(scanRecord)
  res.json({ ok: true, result: scanRecord })
})

// ═══════════════════════════════════════════════════════════
// CAMBIAR UBICACIÓN
// ═══════════════════════════════════════════════════════════

app.patch('/api/guias/ubicacion', authMiddleware(), async (req, res) => {
  const { guia_id, ubicacion_codigo } = req.body
  if (!guia_id || !ubicacion_codigo) return res.status(400).json({ error: 'Faltan datos' })
  const ubicR = await db.query('SELECT * FROM ubicaciones WHERE codigo=$1 AND activa=true', [ubicacion_codigo.toUpperCase()])
  if (!ubicR.rows.length) return res.status(404).json({ error: 'Ubicación no encontrada' })
  const ubic = ubicR.rows[0]
  const prev = await db.query('SELECT u.codigo FROM guias g LEFT JOIN ubicaciones u ON g.ubicacion_id=u.id WHERE g.id=$1', [guia_id])
  const prevCodigo = prev.rows[0]?.codigo || null
  await db.query('UPDATE guias SET ubicacion_id=$1 WHERE id=$2', [ubic.id, guia_id])
  await db.query(
    `INSERT INTO escaneos (guia_id, usuario_id, ubicacion_id, tipo, detalle, barcode_raw, dispositivo)
     VALUES ($1,$2,$3,'cambio_ubicacion',$4,$5,'tc22')`,
    [guia_id, req.user.id, ubic.id, `${prevCodigo || 'sin_ubic'} → ${ubicacion_codigo.toUpperCase()}`, ubicacion_codigo.toUpperCase()]
  )
  broadcast({ type: 'ubicacion_updated', guia_id, ubicacion: ubicacion_codigo.toUpperCase() })
  res.json({ ok: true, ubicacion: ubicacion_codigo.toUpperCase() })
})

// ═══════════════════════════════════════════════════════════
// HISTORIAL DE GUÍA (escaneos + notas)
// ═══════════════════════════════════════════════════════════

app.get('/api/guias/:id/historial', authMiddleware(), async (req, res) => {
  const escaneos = await db.query(
    `SELECT e.scanned_at, e.tipo, e.detalle, e.barcode_raw,
            u.username as usuario, ub.codigo as ubicacion
     FROM escaneos e
     LEFT JOIN usuarios u   ON e.usuario_id   = u.id
     LEFT JOIN ubicaciones ub ON e.ubicacion_id = ub.id
     WHERE e.guia_id = $1
     ORDER BY e.scanned_at ASC`,
    [req.params.id]
  )
  const notas = await db.query(
    `SELECT n.created_at as scanned_at, 'nota' as tipo, n.texto as detalle,
            null as barcode_raw, u.username as usuario, null as ubicacion
     FROM notas_guia n
     JOIN usuarios u ON n.usuario_id = u.id
     WHERE n.guia_id = $1`,
    [req.params.id]
  )
  const todo = [...escaneos.rows, ...notas.rows].sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at))
  res.json(todo)
})

// ═══════════════════════════════════════════════════════════
// PIDs
// ═══════════════════════════════════════════════════════════

app.get('/api/guias/:id/pids', authMiddleware(), async (req, res) => {
  const r = await db.query(
    'SELECT * FROM pids WHERE guia_id=$1 ORDER BY created_at',
    [req.params.id]
  )
  res.json(r.rows)
})

app.post('/api/guias/:id/pids', authMiddleware(['admin', 'supervisor']), async (req, res) => {
  const { pids } = req.body  // array de strings
  if (!Array.isArray(pids) || !pids.length) return res.status(400).json({ error: 'pids requerido' })
  let count = 0
  for (const pid of pids) {
    if (!pid?.trim()) continue
    await db.query(
      `INSERT INTO pids (guia_id, pid) VALUES ($1,$2) ON CONFLICT (guia_id, pid) DO NOTHING`,
      [req.params.id, pid.trim()]
    )
    count++
  }
  // Actualizar total_bultos de la guia
  await db.query(
    `UPDATE guias SET total_bultos = (SELECT COUNT(*) FROM pids WHERE guia_id=$1) WHERE id=$1`,
    [req.params.id]
  )
  res.json({ ok: true, loaded: count })
})

// ═══════════════════════════════════════════════════════════
// NOTAS EN GUÍAS
// ═══════════════════════════════════════════════════════════

app.post('/api/guias/:id/notas', authMiddleware(), async (req, res) => {
  const { texto } = req.body
  if (!texto?.trim()) return res.status(400).json({ error: 'texto requerido' })
  const r = await db.query(
    `INSERT INTO notas_guia (guia_id, usuario_id, texto) VALUES ($1,$2,$3) RETURNING *`,
    [req.params.id, req.user.id, texto.trim()]
  )
  broadcast({ type: 'nota_added', guia_id: req.params.id })
  res.json(r.rows[0])
})

// ═══════════════════════════════════════════════════════════
// LISTA DE INVENTARIO
// ═══════════════════════════════════════════════════════════

app.post('/api/listas/load', authMiddleware(['admin', 'supervisor']), upload.single('file'), async (req, res) => {
  const { fecha } = req.body
  if (!req.file) return res.status(400).json({ error: 'archivo requerido' })

  const dia  = await getOrCreateDia(fecha)
  const rows = parseFile(req.file.buffer, req.file.originalname)

  // Agrupar filas por numero_guia — cada fila duplicada cuenta como 1 bulto adicional
  const guiasMap = new Map()
  for (const row of rows) {
    const numero_guia = col(row, COL.guia)
    if (!numero_guia) continue
    if (!guiasMap.has(numero_guia)) {
      guiasMap.set(numero_guia, {
        numero_guia,
        numero_master: col(row, COL.master),
        destino:       col(row, COL.destino),
        remitente:     col(row, COL.remitente),
        cliente:       col(row, COL.cliente),
        descripcion:   col(row, COL.descripcion),
        proceso:       col(row, COL.proceso),
        pids:          [],
        total_bultos:  0,
      })
    }
    const entry = guiasMap.get(numero_guia)
    entry.total_bultos++
    const pidVal = row['PID'] || row['pid'] || null
    if (pidVal?.trim()) entry.pids.push(pidVal.trim())
  }

  let count = 0
  for (const [, g] of guiasMap) {
    const guiaR = await db.query(
      `INSERT INTO guias (dia_id, numero_guia, numero_master, destino, remitente, cliente, descripcion, proceso, total_bultos, estatus)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pendiente'::estatus_guia)
       ON CONFLICT (dia_id, numero_guia) DO UPDATE SET
         numero_master = EXCLUDED.numero_master,
         destino       = COALESCE(EXCLUDED.destino,       guias.destino),
         remitente     = COALESCE(EXCLUDED.remitente,     guias.remitente),
         cliente       = COALESCE(EXCLUDED.cliente,       guias.cliente),
         descripcion   = COALESCE(EXCLUDED.descripcion,   guias.descripcion),
         proceso       = COALESCE(EXCLUDED.proceso,       guias.proceso),
         total_bultos  = EXCLUDED.total_bultos,
         updated_at    = NOW()
       RETURNING id`,
      [dia.id, g.numero_guia, g.numero_master, g.destino, g.remitente,
       g.cliente, g.descripcion, g.proceso, g.total_bultos]
    )
    if (g.pids.length && guiaR.rows[0]) {
      for (const pid of g.pids) {
        await db.query(
          `INSERT INTO pids (guia_id, pid) VALUES ($1,$2) ON CONFLICT (guia_id, pid) DO NOTHING`,
          [guiaR.rows[0].id, pid]
        )
      }
    }
    count++
  }

  await db.query(
    'UPDATE dias_operacion SET lista_inv_cargada=true, lista_inv_at=NOW(), lista_inv_usuario=$1 WHERE id=$2',
    [req.user.id, dia.id]
  )
  const totalBultos = rows.filter(r => col(r, COL.guia)).length
  broadcast({ type: 'lista_loaded', count, fecha })
  res.json({ ok: true, loaded: count, bultos: totalBultos })
})


app.get('/api/listas/status', authMiddleware(), async (req, res) => {
  const f = req.query.fecha || new Date().toISOString().split('T')[0]
  const r = await db.query('SELECT * FROM dias_operacion WHERE fecha=$1', [f])
  if (!r.rows.length) return res.json({ inv: null })
  const d = r.rows[0]
  const countR = await db.query('SELECT COUNT(*) as n FROM guias WHERE dia_id=$1', [d.id])
  res.json({
    inv: {
      cargada: d.lista_inv_cargada,
      hora:    d.lista_inv_at ? new Date(d.lista_inv_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}) : null,
      count:   parseInt(countR.rows[0].n)
    }
  })
})

// ═══════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════

app.get('/api/stats', authMiddleware(), async (req, res) => {
  const r = await db.query(
    `SELECT
       COUNT(*)                                                  as total,
       COUNT(*) FILTER (WHERE estatus='pendiente')               as pendientes,
       COUNT(*) FILTER (WHERE estatus='escaneada')               as escaneadas,
       COUNT(*) FILTER (WHERE estatus='transito_local')          as transito_local,
       COUNT(*) FILTER (WHERE estatus='transito_mty')            as transito_mty,
       COUNT(*) FILTER (WHERE estatus='desconocida')             as desconocidas,
       COUNT(*) FILTER (WHERE estatus='abandono')                as abandonos
     FROM guias`
  )
  const row = r.rows[0]
  res.json({
    total:         parseInt(row.total),
    pendientes:    parseInt(row.pendientes),
    escaneadas:    parseInt(row.escaneadas),
    transito_local:parseInt(row.transito_local),
    transito_mty:  parseInt(row.transito_mty),
    desconocidas:  parseInt(row.desconocidas),
    abandonos:     parseInt(row.abandonos),
  })
})

// ═══════════════════════════════════════════════════════════
// GUÍAS — búsqueda global
// ═══════════════════════════════════════════════════════════

app.get('/api/guias', authMiddleware(), async (req, res) => {
  const { filter = 'all', page = 1, limit = 50, search } = req.query
  const offset = (parseInt(page)-1) * parseInt(limit)

  let where    = 'WHERE 1=1'
  const params = []
  let idx = 1

  if (filter !== 'all') { where += ` AND g.estatus=$${idx++}`; params.push(filter) }
  if (search) {
    where += ` AND (g.numero_guia ILIKE $${idx} OR g.cliente ILIKE $${idx} OR g.destino ILIKE $${idx})`
    params.push(`%${search}%`); idx++
  }

  const total = await db.query(`SELECT COUNT(*) FROM guias g ${where}`, params)
  const items = await db.query(
    `SELECT g.*, u.codigo as ubicacion, u.etiqueta as ubicacion_etiqueta, d.fecha as dia_fecha
     FROM guias g
     JOIN dias_operacion d ON g.dia_id=d.id
     LEFT JOIN ubicaciones u ON g.ubicacion_id=u.id
     ${where}
     ORDER BY g.ultimo_escaneo DESC NULLS LAST, g.created_at DESC
     LIMIT $${idx} OFFSET $${idx+1}`,
    [...params, parseInt(limit), offset]
  )
  res.json({ total: parseInt(total.rows[0].count), page: parseInt(page), items: items.rows })
})

// ═══════════════════════════════════════════════════════════
// ADMIN — USUARIOS
// ═══════════════════════════════════════════════════════════

app.get('/api/admin/usuarios', authMiddleware(['admin']), async (req, res) => {
  const r = await db.query('SELECT id, username, rol, activo, created_at FROM usuarios ORDER BY created_at')
  res.json(r.rows)
})

app.post('/api/admin/usuarios', authMiddleware(['admin']), async (req, res) => {
  const { username, password, rol } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Faltan datos' })
  const hash = await bcrypt.hash(password, 10)
  const r = await db.query(
    'INSERT INTO usuarios (username, password_hash, rol) VALUES ($1,$2,$3) RETURNING id,username,rol,activo,created_at',
    [username, hash, rol || 'operador']
  )
  res.json(r.rows[0])
})

app.patch('/api/admin/usuarios/:id/password', authMiddleware(['admin']), async (req, res) => {
  const { password } = req.body
  if (!password || password.length < 6) return res.status(400).json({ error: 'Contraseña muy corta' })
  const hash = await bcrypt.hash(password, 10)
  await db.query('UPDATE usuarios SET password_hash=$1 WHERE id=$2', [hash, req.params.id])
  res.json({ ok: true })
})

app.patch('/api/admin/usuarios/:id', authMiddleware(['admin']), async (req, res) => {
  const { activo, rol } = req.body
  await db.query('UPDATE usuarios SET activo=COALESCE($1,activo), rol=COALESCE($2,rol) WHERE id=$3', [activo, rol, req.params.id])
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════
// UBICACIONES
// ═══════════════════════════════════════════════════════════

app.get('/api/ubicaciones', authMiddleware(), async (req, res) => {
  const r = await db.query('SELECT * FROM ubicaciones ORDER BY zona, rack, nivel')
  res.json(r.rows)
})

app.post('/api/ubicaciones', authMiddleware(['admin']), async (req, res) => {
  const { codigo, zona, rack, nivel, etiqueta } = req.body
  if (!codigo) return res.status(400).json({ error: 'codigo requerido' })
  const r = await db.query(
    'INSERT INTO ubicaciones (codigo, zona, rack, nivel, etiqueta) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [codigo.toUpperCase(), zona?.toUpperCase(), rack?.toUpperCase(), nivel?.toUpperCase(), etiqueta?.trim() || null]
  )
  res.json(r.rows[0])
})

app.patch('/api/ubicaciones/:id', authMiddleware(['admin']), async (req, res) => {
  const { etiqueta } = req.body
  await db.query('UPDATE ubicaciones SET etiqueta=$1 WHERE id=$2', [etiqueta?.trim() || null, req.params.id])
  res.json({ ok: true })
})

app.delete('/api/ubicaciones/:id', authMiddleware(['admin']), async (req, res) => {
  await db.query('UPDATE guias SET ubicacion_id=NULL WHERE ubicacion_id=$1', [req.params.id])
  await db.query('DELETE FROM ubicaciones WHERE id=$1', [req.params.id])
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════
// ABANDONO
// ═══════════════════════════════════════════════════════════

app.patch('/api/guias/:id/abandono', authMiddleware(['admin']), async (req, res) => {
  await db.query(
    `UPDATE guias SET estatus='abandono'::estatus_guia, cerrado_como='abandono', cerrado_por=$1, cerrado_at=NOW() WHERE id=$2`,
    [req.user.id, req.params.id]
  )
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════
// AUDITORÍA
// ═══════════════════════════════════════════════════════════

app.post('/api/auditoria/iniciar', authMiddleware(['admin','supervisor']), async (req, res) => {
  // Obtener snapshot del sistema para comparar
  const sistemR = await db.query(
    `SELECT g.id, g.numero_guia, g.estatus, u.codigo as ubicacion, u.etiqueta as ubicacion_etiqueta
     FROM guias g
     LEFT JOIN ubicaciones u ON g.ubicacion_id = u.id
     ORDER BY u.codigo, g.numero_guia`
  )
  const audit = await db.query(
    `INSERT INTO auditorias (usuario_id, total_sistema) VALUES ($1,$2) RETURNING *`,
    [req.user.id, sistemR.rows.length]
  )
  res.json({ auditoria_id: audit.rows[0].id, guias_sistema: sistemR.rows })
})

app.post('/api/auditoria/:id/scan', authMiddleware(['admin','supervisor']), async (req, res) => {
  const { barcode } = req.body
  if (!barcode) return res.status(400).json({ error: 'barcode requerido' })

  // Buscar la guia en sistema
  const guiaR = await db.query(
    `SELECT g.id, g.numero_guia, g.estatus, u.codigo as ubicacion
     FROM guias g
     LEFT JOIN ubicaciones u ON g.ubicacion_id = u.id
     WHERE g.numero_guia = $1
     ORDER BY (SELECT fecha FROM dias_operacion WHERE id=g.dia_id) DESC LIMIT 1`,
    [barcode.trim()]
  )

  const guia      = guiaR.rows[0] || null
  const resultado = guia ? 'coincidencia' : 'sobrante'

  await db.query(
    `INSERT INTO auditoria_items (auditoria_id, guia_id, numero_guia, ubicacion, resultado)
     VALUES ($1,$2,$3,$4,$5)`,
    [req.params.id, guia?.id || null, barcode.trim(), guia?.ubicacion || null, resultado]
  )

  res.json({ resultado, guia: guia || null })
})

app.post('/api/auditoria/:id/cerrar', authMiddleware(['admin','supervisor']), async (req, res) => {
  // Calcular faltantes: guías en sistema que nunca fueron escaneadas en esta auditoría
  const audit = await db.query('SELECT * FROM auditorias WHERE id=$1', [req.params.id])
  if (!audit.rows.length) return res.status(404).json({ error: 'Auditoría no encontrada' })

  const escaneadasR = await db.query(
    `SELECT DISTINCT guia_id FROM auditoria_items WHERE auditoria_id=$1 AND guia_id IS NOT NULL`,
    [req.params.id]
  )
  const escaneadasIds = escaneadasR.rows.map(r => r.guia_id)

  // Guias en sistema activo (pendiente/escaneada) que no fueron auditadas
  const faltantesR = await db.query(
    `SELECT g.id, g.numero_guia, u.codigo as ubicacion
     FROM guias g
     LEFT JOIN ubicaciones u ON g.ubicacion_id = u.id
     WHERE g.estatus NOT IN ('abandono','transito_local','transito_mty')
     AND g.id != ALL($1::uuid[])`,
    [escaneadasIds.length ? escaneadasIds : []]
  )

  for (const f of faltantesR.rows) {
    await db.query(
      `INSERT INTO auditoria_items (auditoria_id, guia_id, numero_guia, ubicacion, resultado)
       VALUES ($1,$2,$3,$4,'faltante')`,
      [req.params.id, f.id, f.numero_guia, f.ubicacion || null]
    )
  }

  const itemsR    = await db.query('SELECT resultado, COUNT(*) as n FROM auditoria_items WHERE auditoria_id=$1 GROUP BY resultado', [req.params.id])
  const counts    = { coincidencia:0, sobrante:0, faltante:0 }
  itemsR.rows.forEach(r => { counts[r.resultado] = parseInt(r.n) })

  await db.query(
    `UPDATE auditorias SET cerrada=true, cerrada_at=NOW(),
       total_fisico=$2, coincidencias=$3, sobrantes=$4, faltantes=$5
     WHERE id=$1`,
    [req.params.id, counts.coincidencia + counts.sobrante, counts.coincidencia, counts.sobrante, counts.faltante]
  )

  res.json({ ok: true, coincidencias: counts.coincidencia, sobrantes: counts.sobrante, faltantes: counts.faltante })
})

app.get('/api/auditoria/:id/reporte', authMiddleware(['admin','supervisor']), async (req, res) => {
  const XLSX    = require('xlsx')
  const auditR  = await db.query('SELECT a.*, u.username FROM auditorias a JOIN usuarios u ON a.usuario_id=u.id WHERE a.id=$1', [req.params.id])
  if (!auditR.rows.length) return res.status(404).json({ error: 'Auditoría no encontrada' })
  const audit   = auditR.rows[0]
  const itemsR  = await db.query(
    'SELECT resultado, numero_guia, ubicacion, scanned_at FROM auditoria_items WHERE auditoria_id=$1 ORDER BY resultado, numero_guia',
    [req.params.id]
  )

  const filas = itemsR.rows.map(i => ({
    'Resultado':   i.resultado === 'coincidencia' ? 'Coincidencia' : i.resultado === 'sobrante' ? 'Sobrante' : 'Faltante',
    'Guia':        i.numero_guia,
    'Ubicacion':   i.ubicacion || '',
    'Registrado':  new Date(i.scanned_at).toLocaleString('es-MX',{hour12:false}),
  }))

  const ws = XLSX.utils.json_to_sheet(filas)
  ws['!cols'] = [{wch:14},{wch:20},{wch:12},{wch:20}]

  const resumen = [
    { 'Concepto':'Supervisor',     'Valor': audit.username },
    { 'Concepto':'Fecha',          'Valor': new Date(audit.iniciada_at).toLocaleString('es-MX',{hour12:false}) },
    { 'Concepto':'Total sistema',  'Valor': audit.total_sistema },
    { 'Concepto':'Total fisico',   'Valor': audit.total_fisico },
    { 'Concepto':'Coincidencias',  'Valor': audit.coincidencias },
    { 'Concepto':'Sobrantes',      'Valor': audit.sobrantes },
    { 'Concepto':'Faltantes',      'Valor': audit.faltantes },
  ]
  const wsRes = XLSX.utils.json_to_sheet(resumen)
  wsRes['!cols'] = [{wch:16},{wch:22}]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle')
  XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen')
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' })
  const fecha = new Date(audit.iniciada_at).toISOString().split('T')[0]
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition',`attachment; filename="auditoria_${fecha}.xlsx"`)
  res.send(buf)
})

// ═══════════════════════════════════════════════════════════
// REPORTE EXCEL — fix: admin y supervisor
// ═══════════════════════════════════════════════════════════

app.get('/api/reporte', authMiddleware(['admin','supervisor']), async (req, res) => {
  const { filter = 'all', search } = req.query
  let where    = 'WHERE 1=1'
  const params = []
  let idx = 1
  if (filter !== 'all') { where += ` AND g.estatus=$${idx++}`; params.push(filter) }
  if (search) { where += ` AND (g.numero_guia ILIKE $${idx} OR g.cliente ILIKE $${idx})`; params.push(`%${search}%`); idx++ }

  const r = await db.query(
    `SELECT g.numero_guia, g.numero_master, g.destino, g.remitente, g.cliente,
            g.descripcion, g.proceso, g.total_bultos, g.bultos_escaneados,
            g.estatus, g.tipo_transito,
            u.codigo as ubicacion, u.etiqueta as ubicacion_etiqueta,
            g.ultimo_escaneo, g.cerrado_como, d.fecha as dia_fecha,
            (SELECT usr.username FROM escaneos e2
             JOIN usuarios usr ON e2.usuario_id=usr.id
             WHERE e2.guia_id=g.id AND e2.tipo='escaneo'
             ORDER BY e2.scanned_at DESC LIMIT 1) as escaneado_por
     FROM guias g
     JOIN dias_operacion d ON g.dia_id=d.id
     LEFT JOIN ubicaciones u ON g.ubicacion_id=u.id
     ${where}
     ORDER BY g.estatus, g.ultimo_escaneo DESC NULLS LAST`,
    params
  )

  const XLSX  = require('xlsx')
  const STS   = { pendiente:'Pendiente', escaneada:'Escaneada', transito_local:'Transito Local', transito_mty:'Transito MTY', desconocida:'Desconocida', abandono:'Abandono' }
  const filas = r.rows.map(g => ({
    'Fecha ingreso':   g.dia_fecha ? new Date(g.dia_fecha).toLocaleDateString('es-MX') : '',
    'Guia':            g.numero_guia,
    'Master':          g.numero_master || '',
    'Destino':         g.destino || '',
    'Remitente':       g.remitente || '',
    'Cliente':         g.cliente || '',
    'Descripcion':     g.descripcion || '',
    'Proceso':         g.proceso || '',
    'Bultos total':    g.total_bultos,
    'Bultos esc.':     g.bultos_escaneados,
    'Estatus':         STS[g.estatus] || g.estatus,
    'Tipo transito':   g.tipo_transito || '',
    'Ubicacion':       g.ubicacion || '',
    'Etiqueta ubic.':  g.ubicacion_etiqueta || '',
    'Escaneado por':   g.escaneado_por || '',
    'Ultimo mov.':     g.ultimo_escaneo ? new Date(g.ultimo_escaneo).toLocaleString('es-MX',{hour12:false}) : '',
  }))

  const ws = XLSX.utils.json_to_sheet(filas)
  ws['!cols'] = [{wch:14},{wch:16},{wch:16},{wch:12},{wch:28},{wch:28},{wch:24},{wch:14},{wch:10},{wch:10},{wch:16},{wch:14},{wch:12},{wch:18},{wch:16},{wch:20}]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
  const stats = {
    'Total': r.rows.length,
    'Pendientes': r.rows.filter(g=>g.estatus==='pendiente').length,
    'Escaneadas': r.rows.filter(g=>g.estatus==='escaneada').length,
    'Transito Local': r.rows.filter(g=>g.estatus==='transito_local').length,
    'Transito MTY': r.rows.filter(g=>g.estatus==='transito_mty').length,
    'Desconocidas': r.rows.filter(g=>g.estatus==='desconocida').length,
    'Abandono': r.rows.filter(g=>g.estatus==='abandono').length,
  }
  const wsRes = XLSX.utils.json_to_sheet(Object.entries(stats).map(([k,v])=>({'Concepto':k,'Cantidad':v})))
  wsRes['!cols'] = [{wch:18},{wch:12}]
  XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen')
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' })
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition',`attachment; filename="inventario_${new Date().toISOString().split('T')[0]}.xlsx"`)
  res.send(buf)
})

// ═══════════════════════════════════════════════════════════
// HISTÓRICO COMPLETO — Excel 3 hojas (solo admin)
// ═══════════════════════════════════════════════════════════

app.get('/api/historico', authMiddleware(['admin']), async (req, res) => {
  const XLSX = require('xlsx')
  const STS  = { pendiente:'Pendiente', escaneada:'Escaneada', transito_local:'Transito Local', transito_mty:'Transito MTY', desconocida:'Desconocida', abandono:'Abandono' }
  const TIPO = { escaneo:'Escaneo', consulta:'Consulta', cambio_ubicacion:'Cambio ubicacion', transito:'Transito', nota:'Nota' }

  const guiasR = await db.query(
    `SELECT g.numero_guia, g.numero_master, g.destino, g.remitente, g.cliente,
            g.descripcion, g.proceso, g.total_bultos, g.bultos_escaneados,
            g.estatus, g.tipo_transito, u.codigo as ubicacion, u.etiqueta as ubicacion_etiqueta,
            g.ultimo_escaneo, g.cerrado_como, d.fecha as dia_fecha,
            (SELECT usr.username FROM escaneos e2
             JOIN usuarios usr ON e2.usuario_id=usr.id
             WHERE e2.guia_id=g.id AND e2.tipo='escaneo'
             ORDER BY e2.scanned_at DESC LIMIT 1) as escaneado_por
     FROM guias g
     JOIN dias_operacion d ON g.dia_id=d.id
     LEFT JOIN ubicaciones u ON g.ubicacion_id=u.id
     ORDER BY d.fecha DESC, g.estatus`
  )
  const filasGuias = guiasR.rows.map(g => ({
    'Fecha ingreso': g.dia_fecha ? new Date(g.dia_fecha).toLocaleDateString('es-MX') : '',
    'Guia':          g.numero_guia,
    'Master':        g.numero_master || '',
    'Destino':       g.destino || '',
    'Remitente':     g.remitente || '',
    'Cliente':       g.cliente || '',
    'Descripcion':   g.descripcion || '',
    'Proceso':       g.proceso || '',
    'Bultos total':  g.total_bultos,
    'Bultos esc.':   g.bultos_escaneados,
    'Estatus':       STS[g.estatus] || g.estatus,
    'Tipo transito': g.tipo_transito || '',
    'Ubicacion':     g.ubicacion || '',
    'Etiqueta':      g.ubicacion_etiqueta || '',
    'Escaneado por': g.escaneado_por || '',
    'Ultimo mov.':   g.ultimo_escaneo ? new Date(g.ultimo_escaneo).toLocaleString('es-MX',{hour12:false}) : '',
    'Cerrado como':  g.cerrado_como || '',
  }))
  const wsGuias = XLSX.utils.json_to_sheet(filasGuias)

  const escaneoR = await db.query(
    `SELECT e.scanned_at, g.numero_guia, e.tipo, e.detalle,
            u2.username as operador, ub.codigo as ubicacion
     FROM escaneos e
     JOIN guias g ON e.guia_id = g.id
     LEFT JOIN usuarios u2 ON e.usuario_id = u2.id
     LEFT JOIN ubicaciones ub ON e.ubicacion_id = ub.id
     ORDER BY e.scanned_at DESC`
  )
  const filasEscaneos = escaneoR.rows.map(e => ({
    'Fecha/Hora':  new Date(e.scanned_at).toLocaleString('es-MX',{hour12:false}),
    'Guia':        e.numero_guia,
    'Tipo':        TIPO[e.tipo] || e.tipo,
    'Detalle':     e.detalle || '',
    'Operador':    e.operador || '',
    'Ubicacion':   e.ubicacion || '',
  }))
  const wsEscaneos = XLSX.utils.json_to_sheet(filasEscaneos)

  const operR = await db.query(
    `SELECT u.username, u.rol,
            COUNT(e.id) as total_movimientos,
            COUNT(e.id) FILTER (WHERE e.tipo='escaneo') as escaneos,
            COUNT(e.id) FILTER (WHERE e.tipo='transito') as transitos,
            COUNT(e.id) FILTER (WHERE e.tipo='consulta') as consultas,
            COUNT(e.id) FILTER (WHERE e.tipo='cambio_ubicacion') as cambios_ubic,
            COUNT(DISTINCT e.guia_id) as guias_unicas,
            MIN(e.scanned_at) as primer_mov,
            MAX(e.scanned_at) as ultimo_mov
     FROM usuarios u
     LEFT JOIN escaneos e ON e.usuario_id = u.id
     GROUP BY u.id, u.username, u.rol
     ORDER BY total_movimientos DESC`
  )
  const filasOper = operR.rows.map(o => ({
    'Operador':          o.username,
    'Rol':               o.rol,
    'Total movimientos': parseInt(o.total_movimientos),
    'Escaneos':          parseInt(o.escaneos),
    'Transitos':         parseInt(o.transitos),
    'Consultas':         parseInt(o.consultas),
    'Cambios ubicacion': parseInt(o.cambios_ubic),
    'Guias unicas':      parseInt(o.guias_unicas),
    'Primer movimiento': o.primer_mov ? new Date(o.primer_mov).toLocaleString('es-MX',{hour12:false}) : '-',
    'Ultimo movimiento': o.ultimo_mov ? new Date(o.ultimo_mov).toLocaleString('es-MX',{hour12:false}) : '-',
  }))
  const wsOper = XLSX.utils.json_to_sheet(filasOper)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsGuias,   'Guias')
  XLSX.utils.book_append_sheet(wb, wsEscaneos,'Movimientos')
  XLSX.utils.book_append_sheet(wb, wsOper,    'Resumen operadores')
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' })
  const fecha = new Date().toISOString().split('T')[0]
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition',`attachment; filename="historico_${fecha}.xlsx"`)
  res.send(buf)
})

// ═══════════════════════════════════════════════════════════
// MANTENIMIENTO
// ═══════════════════════════════════════════════════════════

app.get('/api/mantenimiento/preview', authMiddleware(['admin']), async (req, res) => {
  const { opcion, rango } = req.query
  let fechaCorte = null
  if (rango === '1semana')  fechaCorte = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000)
  if (rango === '4semanas') fechaCorte = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
  let escaneos = 0, guias = 0, dias = 0
  if (opcion === '1') {
    const q = fechaCorte
      ? await db.query('SELECT COUNT(*) FROM escaneos WHERE scanned_at < $1', [fechaCorte])
      : await db.query('SELECT COUNT(*) FROM escaneos')
    escaneos = parseInt(q.rows[0].count)
  }
  if (opcion === '2') {
    if (fechaCorte) {
      const qe = await db.query('SELECT COUNT(*) FROM escaneos e JOIN guias g ON e.guia_id=g.id JOIN dias_operacion d ON g.dia_id=d.id WHERE d.fecha < $1', [fechaCorte])
      const qg = await db.query('SELECT COUNT(*) FROM guias g JOIN dias_operacion d ON g.dia_id=d.id WHERE d.fecha < $1', [fechaCorte])
      const qd = await db.query('SELECT COUNT(*) FROM dias_operacion WHERE fecha < $1', [fechaCorte])
      escaneos = parseInt(qe.rows[0].count); guias = parseInt(qg.rows[0].count); dias = parseInt(qd.rows[0].count)
    } else {
      const qe = await db.query('SELECT COUNT(*) FROM escaneos')
      const qg = await db.query('SELECT COUNT(*) FROM guias')
      const qd = await db.query('SELECT COUNT(*) FROM dias_operacion')
      escaneos = parseInt(qe.rows[0].count); guias = parseInt(qg.rows[0].count); dias = parseInt(qd.rows[0].count)
    }
  }
  if (opcion === '3') {
    const qe = await db.query('SELECT COUNT(*) FROM escaneos')
    const qg = await db.query('SELECT COUNT(*) FROM guias')
    const qd = await db.query('SELECT COUNT(*) FROM dias_operacion')
    escaneos = parseInt(qe.rows[0].count); guias = parseInt(qg.rows[0].count); dias = parseInt(qd.rows[0].count)
  }
  res.json({ escaneos, guias, dias, fechaCorte: fechaCorte?.toISOString().split('T')[0] || null })
})

app.post('/api/mantenimiento/ejecutar', authMiddleware(['admin']), async (req, res) => {
  const { opcion, rango, confirmacion } = req.body
  if (confirmacion !== 'CONFIRMAR') return res.status(400).json({ error: 'Confirmacion incorrecta' })
  let fechaCorte = null
  if (rango === '1semana')  fechaCorte = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000)
  if (rango === '4semanas') fechaCorte = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
  try {
    if (opcion === '1') {
      fechaCorte
        ? await db.query('DELETE FROM escaneos WHERE scanned_at < $1', [fechaCorte])
        : await db.query('DELETE FROM escaneos')
    }
    if (opcion === '2') {
      if (fechaCorte) {
        await db.query('DELETE FROM escaneos e USING guias g, dias_operacion d WHERE e.guia_id=g.id AND g.dia_id=d.id AND d.fecha < $1', [fechaCorte])
        await db.query('DELETE FROM guias g USING dias_operacion d WHERE g.dia_id=d.id AND d.fecha < $1', [fechaCorte])
        await db.query('DELETE FROM dias_operacion WHERE fecha < $1', [fechaCorte])
      } else {
        await db.query('DELETE FROM escaneos')
        await db.query('DELETE FROM guias')
        await db.query('DELETE FROM dias_operacion')
      }
    }
    if (opcion === '3') {
      await db.query('DELETE FROM escaneos')
      await db.query('DELETE FROM guias')
      await db.query('DELETE FROM dias_operacion')
    }
    broadcast({ type: 'mantenimiento', opcion, rango })
    res.json({ ok: true })
  } catch (e) {
    console.error('Error mantenimiento:', e)
    res.status(500).json({ error: 'Error al ejecutar el borrado' })
  }
})

// ═══════════════════════════════════════════════════════════
// Health
// ═══════════════════════════════════════════════════════════

app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date() }))

const PORT = process.env.PORT || 3000
app.listen(PORT)
