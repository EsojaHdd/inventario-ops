import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useApi } from '../hooks/useApi'

const API = '/api'

const STATUS_CFG = {
  escaneada:      { label:'Escaneada',       bg:'#dcfce7', text:'#15803d', border:'#86efac', icon:'✓' },
  transito_local: { label:'Tránsito Local',  bg:'#dbeafe', text:'#1d4ed8', border:'#93c5fd', icon:'→' },
  transito_mty:   { label:'Tránsito MTY',    bg:'#ede9fe', text:'#6d28d9', border:'#c4b5fd', icon:'→' },
  pendiente:      { label:'Pendiente',       bg:'#f1f5f9', text:'#64748b', border:'#cbd5e1', icon:'○' },
  desconocida:    { label:'Desconocida',     bg:'#fee2e2', text:'#b91c1c', border:'#fca5a5', icon:'?' },
  abandono:       { label:'Abandono',        bg:'#fef3c7', text:'#b45309', border:'#fcd34d', icon:'!' },
}

const MODES = {
  escaneo:  { label:'Escaneo',           color:'#1e40af', bg:'#dbeafe', desc:'' },
  consulta: { label:'Consulta',          color:'#6b21a8', bg:'#ede9fe', desc:'Solo lectura' },
  transito: { label:'Mandar a Tránsito', color:'#065f46', bg:'#d1fae5', desc:'' },
  auditoria:{ label:'Auditoría',         color:'#b45309', bg:'#fef3c7', desc:'Supervisor' },
}

const TRANSITO_OPTS = [
  { key:'local', label:'Tránsito Local', color:'#1d4ed8', bg:'#dbeafe', border:'#93c5fd' },
  { key:'mty',   label:'Tránsito MTY',   color:'#6d28d9', bg:'#ede9fe', border:'#c4b5fd' },
]

function esUbicacion(code) {
  return /^[A-Z]-[A-Z0-9]-\d+$/i.test(code.trim())
}

// ── DataWedge / EnterpriseBrowser ──────────────────────────
function initEBScanner(onScan) {
  if (typeof window.EB === 'undefined') {
    return initKeystrokeFallback(onScan)
  }
  window.EB.Intent.startListening(
    { intentType: window.EB.Intent.BROADCAST, action: 'com.inventarioops.dw.action' },
    (params) => {
      const scannedData = params['com.symbol.datawedge.data_string']
      if (scannedData?.trim()) onScan(scannedData.trim())
    }
  )
  return () => { try { window.EB.Intent.stopListening() } catch(e) {} }
}

function initKeystrokeFallback(onScan) {
  let buffer = '', timer = null
  const handler = (e) => {
    if (e.key === 'Enter') {
      if (buffer.length > 3) onScan(buffer.trim())
      buffer = ''; clearTimeout(timer); return
    }
    if (e.key.length === 1) {
      buffer += e.key; clearTimeout(timer)
      timer = setTimeout(() => { if (buffer.length > 3) onScan(buffer.trim()); buffer = '' }, 100)
    }
  }
  document.addEventListener('keydown', handler)
  return () => document.removeEventListener('keydown', handler)
}
// ───────────────────────────────────────────────────────────

export default function ScannerTC22() {
  const { user, logout } = useAuth()
  const { apiFetch }     = useApi()
  const isSupervisor     = user?.rol === 'supervisor' || user?.rol === 'admin'

  const [mode, setMode]                   = useState('escaneo')
  const [tipoTransito, setTipoTransito]   = useState(null)
  const [inputVal, setInputVal]           = useState('')
  const [result, setResult]               = useState(null)
  const [loading, setLoading]             = useState(false)
  const [historia, setHistoria]           = useState([])
  const [ubicActiva, setUbicActiva]       = useState(null)
  const [ubicFlash, setUbicFlash]         = useState(false)
  const [changingUbic, setChangingUbic]   = useState(false)
  const [ubicInput, setUbicInput]         = useState('')
  const [showHistorial, setShowHistorial] = useState(false)
  const [historialGuia, setHistorialGuia] = useState([])
  const [loadingHist, setLoadingHist]     = useState(false)
  const [notaTexto, setNotaTexto]         = useState('')
  const [guardandoNota, setGuardandoNota] = useState(false)

  // Consulta de ubicación
  const [ubicConsulta, setUbicConsulta]   = useState(null) // { codigo, guias[] }
  const [loadingUbic, setLoadingUbic]     = useState(false)

  // Auditoría
  const [auditoriaId, setAuditoriaId]     = useState(null)
  const [auditoriaGuias, setAuditoriaGuias] = useState([])  // snapshot sistema
  const [auditoriaScans, setAuditoriaScans] = useState([])  // lo que fue escaneando
  const [auditoriaActiva, setAuditoriaActiva] = useState(false)
  const [cerrando, setCerrando]           = useState(false)
  const [descargando, setDescargando]     = useState(false)

  const inputRef    = useRef(null)
  const procesarRef = useRef(null)

  // Foco permanente — captura cualquier click en la página y devuelve foco al input
  useEffect(() => {
    const mantenerFoco = () => {
      if (mode !== 'auditoria' && document.activeElement !== inputRef.current) {
        inputRef.current?.focus()
      }
    }
    document.addEventListener('click', mantenerFoco)
    document.addEventListener('touchend', mantenerFoco)
    return () => {
      document.removeEventListener('click', mantenerFoco)
      document.removeEventListener('touchend', mantenerFoco)
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'auditoria') setTimeout(() => inputRef.current?.focus(), 50)
  }, [result, changingUbic, ubicActiva, mode, tipoTransito])

  const modoListo = mode !== 'transito' || tipoTransito !== null

  // ── Consulta de ubicación ──────────────────────────────
  const consultarUbicacion = useCallback(async (codigo) => {
    setLoadingUbic(true)
    setUbicConsulta(null)
    try {
      const res  = await apiFetch(`${API}/guias?filter=all&limit=200`)
      const data = await res.json()
      const guiasEnUbic = (data.items || []).filter(g =>
        g.ubicacion?.toUpperCase() === codigo.toUpperCase()
      )
      setUbicConsulta({ codigo: codigo.toUpperCase(), guias: guiasEnUbic })
    } catch { setUbicConsulta({ codigo: codigo.toUpperCase(), guias: [] }) }
    finally { setLoadingUbic(false) }
  }, [apiFetch])

  // ── Escaneo principal ──────────────────────────────────
  const procesarEscaneo = useCallback(async (value) => {
    const raw = value.trim()
    if (!raw) return
    if (mode === 'transito' && !tipoTransito) return
    setInputVal('')
    setChangingUbic(false)
    setUbicInput('')

    // Modo consulta + ubicación → mostrar contenido de ubicación
    if (mode === 'consulta' && esUbicacion(raw)) {
      await consultarUbicacion(raw)
      return
    }

    // Modo escaneo + ubicación → activar estación fija
    if (mode === 'escaneo' && esUbicacion(raw)) {
      setUbicActiva(raw.toUpperCase())
      setResult(null)
      setUbicConsulta(null)
      setUbicFlash(true)
      setTimeout(() => setUbicFlash(false), 800)
      return
    }

    setLoading(true)
    setUbicConsulta(null)
    try {
      const body = { barcode: raw, source: 'tc22', mode }
      if (mode === 'escaneo' && ubicActiva)    body.ubicacion     = ubicActiva
      if (mode === 'transito' && tipoTransito) body.tipo_transito = tipoTransito

      const res  = await apiFetch(`${API}/scan`, { method:'POST', body: JSON.stringify(body) })
      if (!res) return
      const data = await res.json()
      const r    = data.result || data
      setResult(r)
      setHistoria(h => [{ ...r, ts: new Date() }, ...h].slice(0, 20))
    } catch (e) {
      setResult({ status:'error', message: e.message })
    } finally { setLoading(false) }
  }, [mode, tipoTransito, ubicActiva, apiFetch, consultarUbicacion])

  useEffect(() => { procesarRef.current = procesarEscaneo }, [procesarEscaneo])

  // Inicializar EB/Keystroke una sola vez
  useEffect(() => {
    const cleanup = initEBScanner((codigo) => {
      if (mode === 'auditoria') {
        procesarAuditoria(codigo)
      } else if (procesarRef.current) {
        procesarRef.current(codigo)
      }
    })
    return cleanup
  }, [mode])

  // ── Cambio de ubicación ────────────────────────────────
  const cambiarUbicacion = useCallback(async (codigoNuevo) => {
    const raw = codigoNuevo.trim()
    if (!raw || !result) return
    setLoading(true)
    try {
      const res  = await apiFetch(`${API}/guias/ubicacion`, { method:'PATCH', body: JSON.stringify({ guia_id: result.guia_id, ubicacion_codigo: raw }) })
      if (!res) return
      const data = await res.json()
      if (data.ok) {
        setResult(prev => ({ ...prev, ubicacion: raw }))
        setHistoria(h => h.map((x, i) => i === 0 ? { ...x, ubicacion: raw } : x))
      }
    } catch(e) { console.error(e) }
    finally { setLoading(false); setChangingUbic(false); setUbicInput('') }
  }, [result, apiFetch])

  // ── Historial ──────────────────────────────────────────
  const verHistorial = useCallback(async () => {
    if (!result?.guia_id) return
    setLoadingHist(true)
    setShowHistorial(true)
    try {
      const res  = await apiFetch(`${API}/guias/${result.guia_id}/historial`)
      const data = await res.json()
      setHistorialGuia(Array.isArray(data) ? data : [])
    } catch { setHistorialGuia([]) }
    finally { setLoadingHist(false) }
  }, [result, apiFetch])

  // ── Notas ──────────────────────────────────────────────
  const guardarNota = useCallback(async () => {
    if (!notaTexto.trim() || !result?.guia_id) return
    setGuardandoNota(true)
    try {
      await apiFetch(`${API}/guias/${result.guia_id}/notas`, {
        method: 'POST',
        body: JSON.stringify({ texto: notaTexto.trim() })
      })
      setNotaTexto('')
    } catch(e) { console.error(e) }
    finally { setGuardandoNota(false) }
  }, [notaTexto, result, apiFetch])

  // ── Auditoría ──────────────────────────────────────────
  const iniciarAuditoria = async () => {
    setLoading(true)
    try {
      const res  = await apiFetch(`${API}/auditoria/iniciar`, { method:'POST' })
      const data = await res.json()
      setAuditoriaId(data.auditoria_id)
      setAuditoriaGuias(data.guias_sistema || [])
      setAuditoriaScans([])
      setAuditoriaActiva(true)
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  const procesarAuditoria = useCallback(async (barcode) => {
    if (!auditoriaId) return
    try {
      const res  = await apiFetch(`${API}/auditoria/${auditoriaId}/scan`, {
        method: 'POST', body: JSON.stringify({ barcode })
      })
      const data = await res.json()
      setAuditoriaScans(prev => [{ barcode, resultado: data.resultado, guia: data.guia, ts: new Date() }, ...prev])
    } catch(e) { console.error(e) }
  }, [auditoriaId, apiFetch])

  const cerrarAuditoria = async () => {
    if (!auditoriaId) return
    setCerrando(true)
    try {
      await apiFetch(`${API}/auditoria/${auditoriaId}/cerrar`, { method:'POST' })
      setAuditoriaActiva(false)
    } catch(e) { console.error(e) }
    finally { setCerrando(false) }
  }

  const descargarReporteAuditoria = async () => {
    if (!auditoriaId) return
    setDescargando(true)
    try {
      const token = sessionStorage.getItem('inventario_token')
      const res   = await fetch(`${API}/auditoria/${auditoriaId}/reporte`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `auditoria_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch(e) { console.error(e) }
    finally { setDescargando(false) }
  }

  const onKeyDown     = e => { if (e.key === 'Enter') procesarEscaneo(inputVal) }
  const onUbicKeyDown = e => { if (e.key === 'Enter') cambiarUbicacion(ubicInput) }

  const cfg       = result ? (STATUS_CFG[result.status] || STATUS_CFG.pendiente) : null
  const TIPO_ES   = { escaneo:'Escaneo', consulta:'Consulta', cambio_ubicacion:'Cambio ubicación', transito:'Tránsito', nota:'Nota' }
  const isOperador = user?.rol === 'operador'

  // Conteos auditoría en tiempo real
  const auditCoincidencias = auditoriaScans.filter(s => s.resultado === 'coincidencia').length
  const auditSobrantes     = auditoriaScans.filter(s => s.resultado === 'sobrante').length
  const auditTotal         = auditoriaScans.length

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', fontFamily:"'DM Sans','Segoe UI',sans-serif", display:'flex', flexDirection:'column' }}>

      {/* Header */}
      <div style={{ padding:'12px 16px', borderBottom:'1px solid #1e293b', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#3b82f6"/>
            <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#3b82f6"/>
            <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#60a5fa"/>
            <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#60a5fa"/>
          </svg>
          <span style={{ color:'#f1f5f9', fontSize:14, fontWeight:700 }}>InventarioOps</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {!isOperador && <a href="/" style={{ fontSize:12, color:'#64748b', textDecoration:'none' }}>← Dashboard</a>}
          <button onClick={logout} style={{ fontSize:11, color:'#475569', background:'transparent', border:'none', cursor:'pointer' }}>Salir ({user?.username})</button>
        </div>
      </div>

      {/* Selector de modo */}
      <div style={{ padding:'12px 16px', display:'flex', gap:6, flexWrap:'wrap' }}>
        {Object.entries(MODES).map(([k, v]) => {
          if (k === 'auditoria' && !isSupervisor) return null
          return (
            <button key={k}
              onClick={() => {
                setMode(k)
                setResult(null)
                setChangingUbic(false)
                setUbicConsulta(null)
                if (k !== 'transito') setTipoTransito(null)
                if (k !== 'auditoria' && auditoriaActiva) cerrarAuditoria()
              }}
              style={{
                flex:1, minWidth:70, padding:'10px 6px', borderRadius:10, fontSize:12, fontWeight:700, cursor:'pointer',
                border: mode===k ? `2px solid ${v.color}` : '2px solid #1e293b',
                background: mode===k ? v.bg : '#1e293b',
                color: mode===k ? v.color : '#64748b', transition:'all 0.15s', lineHeight:1.3
              }}>
              {v.label}
              {v.desc && <div style={{ fontSize:9, fontWeight:400, marginTop:3, opacity:0.8 }}>{v.desc}</div>}
            </button>
          )
        })}
      </div>

      <div style={{ flex:1, padding:'0 16px 16px', display:'flex', flexDirection:'column', gap:12, overflowY:'auto' }}>

        {/* ── MODO AUDITORÍA ── */}
        {mode === 'auditoria' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {!auditoriaActiva ? (
              <div style={{ background:'#1e293b', borderRadius:14, padding:20, textAlign:'center' }}>
                <div style={{ fontSize:14, color:'#f1f5f9', fontWeight:700, marginBottom:8 }}>Auditoría Global de Bodega</div>
                <div style={{ fontSize:12, color:'#64748b', marginBottom:16 }}>
                  Escanea todas las guías físicas que encuentres.<br/>
                  El sistema comparará contra lo registrado.
                </div>
                <button onClick={iniciarAuditoria} disabled={loading}
                  style={{ padding:'12px 28px', borderRadius:10, background:'#b45309', color:'#fff', border:'none', fontSize:14, fontWeight:700, cursor:'pointer' }}>
                  {loading ? 'Iniciando...' : 'Iniciar auditoría'}
                </button>
              </div>
            ) : (
              <>
                {/* Contadores en tiempo real */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8 }}>
                  {[
                    { label:'Sistema', val: auditoriaGuias.length, bg:'#1e293b', color:'#94a3b8' },
                    { label:'Físico',  val: auditTotal,           bg:'#172554', color:'#93c5fd' },
                    { label:'OK',      val: auditCoincidencias,   bg:'#14532d', color:'#86efac' },
                    { label:'Extras',  val: auditSobrantes,       bg:'#7c2d12', color:'#fdba74' },
                  ].map(c => (
                    <div key={c.label} style={{ background:c.bg, borderRadius:10, padding:'10px 8px', textAlign:'center' }}>
                      <div style={{ fontSize:20, fontWeight:800, color:c.color }}>{c.val}</div>
                      <div style={{ fontSize:10, color:'#475569', fontWeight:600 }}>{c.label}</div>
                    </div>
                  ))}
                </div>

                {/* Input auditoría */}
                <div style={{ background:'#1e293b', borderRadius:14, padding:'14px 16px', border:'2px solid #b45309' }}>
                  <div style={{ fontSize:11, color:'#d97706', marginBottom:8, fontWeight:600, textTransform:'uppercase' }}>
                    Escanear guía física
                  </div>
                  <input
                    ref={inputRef}
                    value={inputVal}
                    onChange={e => setInputVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { procesarAuditoria(inputVal); setInputVal('') } }}
                    inputMode="none"
                    autoComplete="off"
                    placeholder="Escanea el código de guía..."
                    style={{ width:'100%', background:'transparent', border:'none', outline:'none', color:'#f1f5f9', fontSize:18, fontFamily:'monospace', fontWeight:700 }}
                  />
                </div>

                {/* Lista de scans de auditoría */}
                {auditoriaScans.length > 0 && (
                  <div style={{ background:'#1e293b', borderRadius:12, overflow:'hidden' }}>
                    <div style={{ padding:'8px 14px', borderBottom:'1px solid #0f172a', fontSize:11, fontWeight:600, color:'#475569', textTransform:'uppercase' }}>
                      Escaneados ({auditoriaScans.length})
                    </div>
                    {auditoriaScans.slice(0, 15).map((s, i) => (
                      <div key={i} style={{ padding:'8px 14px', borderBottom:'1px solid #0f172a', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <div style={{ fontFamily:'monospace', fontSize:12, fontWeight:600, color:'#e2e8f0' }}>{s.barcode}</div>
                          {s.guia?.ubicacion && <div style={{ fontSize:10, color:'#d97706' }}>{s.guia.ubicacion}</div>}
                        </div>
                        <span style={{
                          fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99,
                          background: s.resultado==='coincidencia'?'#14532d': s.resultado==='sobrante'?'#7c2d12':'#172554',
                          color: s.resultado==='coincidencia'?'#86efac': s.resultado==='sobrante'?'#fdba74':'#93c5fd'
                        }}>
                          {s.resultado==='coincidencia'?'OK': s.resultado==='sobrante'?'Extra':'—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Botones auditoría */}
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={cerrarAuditoria} disabled={cerrando || auditoriaScans.length === 0}
                    style={{ flex:1, padding:'12px', borderRadius:10, background: auditoriaScans.length>0?'#b45309':'#1e293b', color: auditoriaScans.length>0?'#fff':'#475569', border:'none', fontSize:13, fontWeight:700, cursor: auditoriaScans.length>0?'pointer':'default' }}>
                    {cerrando ? 'Calculando faltantes...' : 'Cerrar y calcular faltantes'}
                  </button>
                  {!auditoriaActiva && auditoriaId && (
                    <button onClick={descargarReporteAuditoria} disabled={descargando}
                      style={{ flex:1, padding:'12px', borderRadius:10, background:'#1e40af', color:'#fff', border:'none', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                      {descargando ? 'Descargando...' : '↓ Reporte Excel'}
                    </button>
                  )}
                </div>

                {!auditoriaActiva && auditoriaId && (
                  <div style={{ background:'#14532d', border:'1px solid #166534', borderRadius:10, padding:'12px 16px' }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#86efac', marginBottom:8 }}>Auditoría completada</div>
                    <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                      <span style={{ fontSize:12, color:'#dcfce7' }}>✓ {auditCoincidencias} coincidencias</span>
                      <span style={{ fontSize:12, color:'#fdba74' }}>+ {auditSobrantes} sobrantes</span>
                      <span style={{ fontSize:12, color:'#93c5fd' }}>- faltantes calculados</span>
                    </div>
                    <button onClick={descargarReporteAuditoria} disabled={descargando}
                      style={{ marginTop:10, width:'100%', padding:'10px', borderRadius:8, background:'#166534', color:'#dcfce7', border:'none', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                      {descargando ? 'Descargando...' : '↓ Descargar reporte Excel'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── MODOS NORMALES ── */}
        {mode !== 'auditoria' && (
          <>
            {/* Sub-selector tránsito */}
            {mode === 'transito' && (
              <div style={{ background:'#172554', border:'2px solid #1e40af', borderRadius:14, padding:'14px 16px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#93c5fd', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:10 }}>
                  Selecciona el tipo de tránsito
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {TRANSITO_OPTS.map(opt => (
                    <button key={opt.key} onClick={() => setTipoTransito(opt.key)}
                      style={{
                        flex:1, padding:'12px', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer',
                        border: `2px solid ${tipoTransito===opt.key ? opt.border : '#334155'}`,
                        background: tipoTransito===opt.key ? opt.bg : '#1e293b',
                        color: tipoTransito===opt.key ? opt.color : '#475569', transition:'all 0.15s'
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Banner ubicación activa */}
            {mode === 'escaneo' && (
              <div style={{
                borderRadius:14, padding:'14px 16px',
                background: ubicActiva ? (ubicFlash ? '#1e40af' : '#172554') : '#1e293b',
                border: `2px solid ${ubicActiva ? '#3b82f6' : '#334155'}`,
                display:'flex', alignItems:'center', justifyContent:'space-between', transition:'background 0.3s',
              }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color: ubicActiva?'#93c5fd':'#475569', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>
                    {ubicActiva ? '📍 Ubicación activa' : '📍 Sin ubicación activa'}
                  </div>
                  <div style={{ fontFamily:'monospace', fontSize: ubicActiva?22:13, fontWeight:800, color: ubicActiva?'#f1f5f9':'#334155' }}>
                    {ubicActiva || 'Escanea un código de ubicación para activar'}
                  </div>
                </div>
                {ubicActiva && (
                  <button onClick={() => { setUbicActiva(null); setResult(null) }}
                    style={{ fontSize:11, color:'#64748b', background:'transparent', border:'1px solid #334155', borderRadius:8, padding:'6px 10px', cursor:'pointer' }}>
                    Limpiar
                  </button>
                )}
              </div>
            )}

            {/* Input principal */}
            <div style={{ background:'#1e293b', borderRadius:14, padding:'16px', border:`2px solid ${modoListo ? '#1e40af' : '#334155'}` }}>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:8, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                {mode === 'transito' && tipoTransito
                  ? `Marcar salida → ${tipoTransito==='local'?'Tránsito Local':'Tránsito MTY'}`
                  : mode === 'transito' ? 'Selecciona el tipo de tránsito primero'
                  : mode === 'consulta' ? 'Consultar guía o ubicación (B-A-3)'
                  : ubicActiva ? `Escanear guía → asignará a ${ubicActiva}` : 'Escanear guía o ubicación (B-A-3)'}
              </div>
              <input
                ref={inputRef}
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={onKeyDown}
                autoFocus
                autoComplete="off"
                inputMode="none"
                disabled={!modoListo}
                placeholder={modoListo ? 'Escanea el código...' : 'Selecciona tipo de tránsito arriba'}
                style={{ width:'100%', background:'transparent', border:'none', outline:'none', color: modoListo?'#f1f5f9':'#475569', fontSize:18, fontFamily:'monospace', fontWeight:700 }}
              />
              <button onClick={() => procesarEscaneo(inputVal)} disabled={loading || !inputVal.trim() || !modoListo}
                style={{
                  marginTop:12, width:'100%', padding:'12px', borderRadius:10,
                  background: loading||!modoListo ? '#1e293b' : '#1e40af',
                  color: loading||!modoListo ? '#475569' : '#fff',
                  border:'none', fontSize:15, fontWeight:700,
                  cursor: loading||!inputVal.trim()||!modoListo ? 'default' : 'pointer', transition:'all 0.15s'
                }}>
                {loading ? 'Procesando…' : mode==='consulta'?'Consultar': mode==='transito'?'Registrar salida':'Registrar'}
              </button>
            </div>

            {/* Resultado consulta de ubicación */}
            {mode === 'consulta' && ubicConsulta && (
              <div style={{ background:'#1e1a2e', border:'2px solid #7c3aed', borderRadius:14, overflow:'hidden' }}>
                <div style={{ padding:'12px 16px', borderBottom:'1px solid #2d1b69', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:'#a78bfa', textTransform:'uppercase', letterSpacing:'0.05em' }}>Contenido de ubicación</div>
                    <div style={{ fontFamily:'monospace', fontSize:18, fontWeight:800, color:'#f1f5f9' }}>{ubicConsulta.codigo}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:22, fontWeight:800, color:'#a78bfa' }}>{ubicConsulta.guias.length}</div>
                    <div style={{ fontSize:10, color:'#6d28d9' }}>guías</div>
                  </div>
                </div>
                {loadingUbic ? (
                  <div style={{ padding:20, textAlign:'center', color:'#6d28d9', fontSize:13 }}>Cargando...</div>
                ) : ubicConsulta.guias.length === 0 ? (
                  <div style={{ padding:20, textAlign:'center', color:'#475569', fontSize:13 }}>Sin guías en esta ubicación</div>
                ) : (
                  <div style={{ maxHeight:240, overflowY:'auto' }}>
                    {ubicConsulta.guias.map((g, i) => {
                      const sc = STATUS_CFG[g.estatus] || STATUS_CFG.pendiente
                      return (
                        <div key={i} style={{ padding:'8px 16px', borderBottom:'1px solid #1e293b', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                          <div>
                            <div style={{ fontFamily:'monospace', fontSize:12, fontWeight:700, color:'#e2e8f0' }}>{g.numero_guia}</div>
                            {g.cliente && <div style={{ fontSize:10, color:'#64748b' }}>{g.cliente}</div>}
                          </div>
                          <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:99, background:sc.bg, color:sc.text, whiteSpace:'nowrap' }}>
                            {sc.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div style={{ padding:'8px 16px' }}>
                  <button onClick={() => setUbicConsulta(null)}
                    style={{ fontSize:11, color:'#64748b', background:'transparent', border:'1px solid #334155', borderRadius:8, padding:'5px 12px', cursor:'pointer' }}>
                    Limpiar
                  </button>
                </div>
              </div>
            )}

            {/* Resultado de escaneo */}
            {result && cfg && (
              <div style={{ background:cfg.bg, border:`2px solid ${cfg.border}`, borderRadius:14, padding:'16px', animation:'fadeIn 0.2s ease' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:32, height:32, borderRadius:'50%', background:cfg.border, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:cfg.text }}>
                      {cfg.icon}
                    </div>
                    <span style={{ fontWeight:700, fontSize:16, color:cfg.text }}>{cfg.label}</span>
                  </div>
                  {result.guia_id && (
                    <button onClick={verHistorial}
                      style={{ fontSize:11, fontWeight:600, padding:'4px 10px', borderRadius:8, border:`1px solid ${cfg.border}`, background:'rgba(255,255,255,0.5)', color:cfg.text, cursor:'pointer' }}>
                      📋 Historial
                    </button>
                  )}
                </div>

                <div style={{ fontFamily:'monospace', fontSize:18, fontWeight:800, color:'#0f172a', marginBottom:10, wordBreak:'break-all' }}>
                  {result.barcode}
                </div>

                {/* Contador PIDs / bultos */}
                {result.total_bultos > 1 && (
                  <div style={{ background:'rgba(255,255,255,0.7)', borderRadius:10, padding:'10px 14px', marginBottom:10, display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10, fontWeight:600, color:'#94a3b8', marginBottom:4 }}>BULTOS / PIDs</div>
                      <div style={{ display:'flex', gap:4 }}>
                        {Array.from({ length: result.total_bultos }).map((_, i) => (
                          <div key={i} style={{
                            width:20, height:20, borderRadius:4,
                            background: i < result.bultos_escaneados ? cfg.border : 'rgba(0,0,0,0.1)',
                            border: `1px solid ${cfg.border}`,
                            transition:'background 0.2s'
                          }} />
                        ))}
                      </div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <span style={{ fontSize:24, fontWeight:800, color:cfg.text }}>{result.bultos_escaneados}</span>
                      <span style={{ fontSize:14, color:'#94a3b8' }}>/{result.total_bultos}</span>
                    </div>
                  </div>
                )}

                {/* Ubicación clicable */}
                <div
                  onClick={() => { if (!changingUbic) setChangingUbic(true) }}
                  style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'rgba(255,255,255,0.65)', borderRadius:10, padding:'10px 12px', marginBottom:10, cursor:'pointer' }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:600, color:'#94a3b8', marginBottom:2 }}>UBICACIÓN</div>
                    <div style={{ fontFamily:'monospace', fontWeight:700, color: result.ubicacion?'#d97706':'#cbd5e1', fontSize:15 }}>
                      {result.ubicacion || '— sin asignar'}
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:'#d97706', fontWeight:600 }}>
                    {changingUbic ? '↑ escaneando…' : '✎ cambiar'}
                  </div>
                </div>

                {/* Panel cambio ubicación */}
                {changingUbic && (
                  <div style={{ background:'#fff', border:'2px solid #d97706', borderRadius:10, padding:'12px', marginBottom:10 }}>
                    <div style={{ fontSize:11, color:'#d97706', fontWeight:700, marginBottom:8, textTransform:'uppercase' }}>
                      Nueva ubicación
                    </div>
                    <input
                      onChange={e => setUbicInput(e.target.value.toUpperCase())}
                      onKeyDown={onUbicKeyDown}
                      value={ubicInput}
                      autoComplete="off"
                      inputMode="none"
                      placeholder="Ej: B-A-3"
                      style={{ width:'100%', padding:'10px', borderRadius:8, border:'1px solid #fed7aa', fontSize:18, fontFamily:'monospace', fontWeight:700, color:'#d97706', background:'#fff7ed', outline:'none', marginBottom:10 }}
                    />
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={() => cambiarUbicacion(ubicInput)} disabled={loading || !ubicInput.trim()}
                        style={{ flex:1, padding:'10px', borderRadius:8, background: loading||!ubicInput.trim()?'#f1f5f9':'#d97706', color: loading||!ubicInput.trim()?'#94a3b8':'#fff', border:'none', fontSize:13, fontWeight:700, cursor: loading||!ubicInput.trim()?'default':'pointer' }}>
                        {loading ? 'Guardando…' : 'Confirmar'}
                      </button>
                      <button onClick={() => { setChangingUbic(false); setUbicInput('') }}
                        style={{ padding:'10px 14px', borderRadius:8, background:'transparent', border:'1px solid #e2e8f0', color:'#94a3b8', fontSize:13, cursor:'pointer' }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  {result.destino && (
                    <div style={{ background:'rgba(255,255,255,0.6)', borderRadius:8, padding:'8px 10px' }}>
                      <div style={{ color:'#94a3b8', fontSize:10, fontWeight:600, marginBottom:2 }}>DESTINO</div>
                      <div style={{ fontWeight:700, color:'#0f172a', fontSize:14 }}>{result.destino}</div>
                    </div>
                  )}
                  {result.proceso && (
                    <div style={{ background:'rgba(255,255,255,0.6)', borderRadius:8, padding:'8px 10px' }}>
                      <div style={{ color:'#94a3b8', fontSize:10, fontWeight:600, marginBottom:2 }}>PROCESO</div>
                      <div style={{ fontWeight:700, color:'#0f172a', fontSize:13 }}>{result.proceso}</div>
                    </div>
                  )}
                </div>
                {result.cliente && (
                  <div style={{ marginTop:8, background:'rgba(255,255,255,0.4)', borderRadius:8, padding:'8px 10px', fontSize:12 }}>
                    <span style={{ color:'#94a3b8', fontSize:10, fontWeight:600 }}>CLIENTE · </span>
                    <span style={{ color:'#0f172a' }}>{result.cliente}</span>
                  </div>
                )}

                {/* Agregar nota */}
                {result.guia_id && (
                  <div style={{ marginTop:10, background:'rgba(255,255,255,0.4)', borderRadius:10, padding:'10px 12px' }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', marginBottom:6 }}>
                      Agregar nota
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <input
                        value={notaTexto}
                        onChange={e => setNotaTexto(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); guardarNota() } }}
                        placeholder="Escribe una nota..."
                        inputMode="text"
                        onClick={e => e.stopPropagation()}
                        style={{ flex:1, padding:'8px 10px', borderRadius:8, border:'1px solid rgba(0,0,0,0.1)', fontSize:12, background:'rgba(255,255,255,0.8)', outline:'none' }}
                      />
                      <button onClick={guardarNota} disabled={guardandoNota || !notaTexto.trim()}
                        style={{ padding:'8px 14px', borderRadius:8, background: notaTexto.trim()?'#1e40af':'#e2e8f0', color: notaTexto.trim()?'#fff':'#94a3b8', border:'none', fontSize:12, fontWeight:700, cursor: notaTexto.trim()?'pointer':'default' }}>
                        {guardandoNota ? '...' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Historial de sesión */}
            {historia.length > 0 && (
              <div style={{ background:'#1e293b', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'10px 14px', borderBottom:'1px solid #0f172a', fontSize:11, fontWeight:600, color:'#475569', textTransform:'uppercase', letterSpacing:'0.05em', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>Sesión ({historia.length})</span>
                  <button onClick={() => setHistoria([])} style={{ fontSize:10, color:'#475569', background:'transparent', border:'none', cursor:'pointer' }}>Limpiar</button>
                </div>
                {historia.slice(0, 10).map((h, i) => {
                  const c = STATUS_CFG[h.status] || STATUS_CFG.pendiente
                  return (
                    <div key={i} style={{ padding:'8px 14px', borderBottom:'1px solid #0f172a', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                      <div>
                        <div style={{ fontFamily:'monospace', fontSize:12, fontWeight:600, color:'#e2e8f0' }}>{h.barcode}</div>
                        {h.ubicacion && <div style={{ fontSize:10, color:'#d97706', fontFamily:'monospace' }}>{h.ubicacion}</div>}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:99, background:c.bg, color:c.text, whiteSpace:'nowrap' }}>{c.label}</span>
                        <span style={{ fontSize:10, color:'#334155' }}>{h.ts?.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal historial de guía */}
      {showHistorial && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'flex-end', zIndex:100 }}
          onClick={e => { if (e.target === e.currentTarget) setShowHistorial(false) }}>
          <div style={{ background:'#1e293b', borderRadius:'16px 16px 0 0', width:'100%', maxHeight:'70vh', overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'16px', borderBottom:'1px solid #0f172a', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:14 }}>Historial de guía</div>
                <div style={{ color:'#64748b', fontSize:11, fontFamily:'monospace', marginTop:2 }}>{result?.barcode}</div>
              </div>
              <button onClick={() => setShowHistorial(false)}
                style={{ background:'#334155', border:'none', borderRadius:8, color:'#94a3b8', cursor:'pointer', fontSize:14, width:32, height:32 }}>×</button>
            </div>
            <div style={{ overflowY:'auto', flex:1, padding:'8px 0' }}>
              {loadingHist ? (
                <div style={{ textAlign:'center', padding:32, color:'#475569' }}>Cargando…</div>
              ) : historialGuia.length === 0 ? (
                <div style={{ textAlign:'center', padding:32, color:'#475569', fontSize:13 }}>Sin movimientos registrados</div>
              ) : historialGuia.map((h, i) => (
                <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid #0f172a', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color: h.tipo==='nota'?'#fcd34d':'#f1f5f9' }}>
                      {h.tipo==='nota' ? '📝 Nota' : TIPO_ES[h.tipo] || h.tipo}
                    </div>
                    {h.detalle && <div style={{ fontSize:11, color: h.tipo==='nota'?'#fcd34d':'#d97706', fontFamily: h.tipo==='nota'?'inherit':'monospace', marginTop:2 }}>{h.detalle}</div>}
                    {h.ubicacion && <div style={{ fontSize:11, color:'#60a5fa', marginTop:2 }}>📍 {h.ubicacion}</div>}
                    <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>👤 {h.usuario || '—'}</div>
                  </div>
                  <div style={{ fontSize:10, color:'#475569', whiteSpace:'nowrap', textAlign:'right' }}>
                    {new Date(h.scanned_at).toLocaleDateString('es-MX')}<br/>
                    {new Date(h.scanned_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  )
}
