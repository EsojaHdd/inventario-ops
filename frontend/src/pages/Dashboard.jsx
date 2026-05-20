import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useApi } from '../hooks/useApi'

const API = '/api'

const STATUS_CFG = {
  pendiente:      { label:'Pendiente',      bg:'#f1f5f9', text:'#64748b', border:'#cbd5e1' },
  escaneada:      { label:'Escaneada',      bg:'#dcfce7', text:'#15803d', border:'#86efac' },
  transito_local: { label:'Tránsito Local', bg:'#dbeafe', text:'#1d4ed8', border:'#93c5fd' },
  transito_mty:   { label:'Tránsito MTY',   bg:'#ede9fe', text:'#6d28d9', border:'#c4b5fd' },
  desconocida:    { label:'Desconocida',    bg:'#fee2e2', text:'#b91c1c', border:'#fca5a5' },
  abandono:       { label:'Abandono',       bg:'#fef3c7', text:'#b45309', border:'#fcd34d' },
}

function Badge({ status }) {
  const c = STATUS_CFG[status] || STATUS_CFG.pendiente
  return (
    <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:99, background:c.bg, color:c.text, border:`1px solid ${c.border}`, whiteSpace:'nowrap' }}>
      {c.label}
    </span>
  )
}

function Metric({ label, value, color, sub }) {
  return (
    <div style={{ background:'#fff', border:'1px solid #f1f5f9', borderRadius:12, padding:'16px', textAlign:'center' }}>
      <div style={{ fontSize:26, fontWeight:800, color: color || '#0f172a', lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{sub}</div>}
      <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>{label}</div>
    </div>
  )
}

export default function Dashboard() {
  const { user, logout } = useAuth()
  const { apiFetch, apiFormData } = useApi()

  const [stats, setStats]     = useState({ total:0, pendientes:0, escaneadas:0, transito_local:0, transito_mty:0, desconocidas:0, abandonos:0 })
  const [guias, setGuias]     = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listaStatus, setListaStatus] = useState(null)
  const [uploading, setUploading]     = useState(false)
  const [uploadMsg, setUploadMsg]     = useState(null)
  const [lastScan, setLastScan]       = useState(null)
  const [flash, setFlash]             = useState(null)
  const [showHistorial, setShowHistorial]   = useState(false)
  const [historialGuia, setHistorialGuia]   = useState([])
  const [historialTarget, setHistorialTarget] = useState(null)
  const [loadingHist, setLoadingHist]         = useState(false)

  const wsRef     = useRef(null)
  const fileRef   = useRef(null)
  const searchRef = useRef(null)

  const isSuper = ['admin','supervisor'].includes(user?.rol)
  const today   = new Date().toISOString().split('T')[0]

  const loadStats = useCallback(async () => {
    const r = await apiFetch(`${API}/stats`).then(x => x?.json()).catch(() => null)
    if (r) setStats(r)
  }, [apiFetch])

  const loadGuias = useCallback(async (p = 1, f = filter, s = search) => {
    setLoading(true)
    const params = new URLSearchParams({ filter: f, page: p, limit: 50 })
    if (s) params.set('search', s)
    const r = await apiFetch(`${API}/guias?${params}`).then(x => x?.json()).catch(() => null)
    if (r) { setGuias(r.items || []); setTotal(r.total || 0) }
    setLoading(false)
  }, [apiFetch, filter, search])

  const loadListaStatus = useCallback(async () => {
    const r = await apiFetch(`${API}/listas/status?fecha=${today}`).then(x => x?.json()).catch(() => null)
    if (r) setListaStatus(r.inv)
  }, [apiFetch, today])

  useEffect(() => { loadStats(); loadGuias(1); loadListaStatus() }, [])

  // WebSocket para actualizaciones en tiempo real
  useEffect(() => {
    const wsUrl = `ws://${window.location.hostname}:3001`
    const ws    = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.type === 'scan' || d.type === 'ubicacion_updated') {
          loadStats()
          loadGuias(page)
          if (d.type === 'scan') {
            setLastScan(d); setFlash(d.status); setTimeout(() => setFlash(null), 2500)
          }
        }
        if (d.type === 'lista_loaded') { loadListaStatus(); loadStats(); loadGuias(1) }
      } catch {}
    }
    return () => ws.close()
  }, [page])

  const handleSearch = () => { setSearch(searchInput); setPage(1); loadGuias(1, filter, searchInput) }
  const handleFilter = (f) => { setFilter(f); setPage(1); loadGuias(1, f, search) }
  const handlePage   = (p) => { setPage(p); loadGuias(p) }

  const uploadLista = async (file) => {
    if (!file) return
    setUploading(true); setUploadMsg(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('fecha', today)
    const r = await apiFormData(`${API}/listas/load`, fd)
    if (r?.ok) {
      const d = await r.json()
      setUploadMsg({ ok: true, msg: `✅ ${d.loaded} guías cargadas` })
      loadListaStatus(); loadStats(); loadGuias(1)
    } else {
      setUploadMsg({ ok: false, msg: '❌ Error al cargar el archivo' })
    }
    setUploading(false)
    setTimeout(() => setUploadMsg(null), 5000)
    if (fileRef.current) fileRef.current.value = ''
  }

  const verHistorial = async (guia) => {
    setHistorialTarget(guia)
    setShowHistorial(true)
    setLoadingHist(true)
    try {
      const r = await apiFetch(`${API}/guias/${guia.id}/historial`).then(x => x?.json())
      setHistorialGuia(Array.isArray(r) ? r : [])
    } catch { setHistorialGuia([]) }
    finally { setLoadingHist(false) }
  }

  const exportar = async () => {
    const params = new URLSearchParams({ filter })
    if (search) params.set('search', search)
    const token = sessionStorage.getItem('inventario_token')
    try {
      const res  = await fetch(`${API}/reporte?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `inventario_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { console.error('Error exportar:', e) }
  }

  const pct = stats.total > 0
    ? Math.round(((stats.escaneadas + stats.transito_local + stats.transito_mty) / stats.total) * 100)
    : 0

  const TIPO_ES = { escaneo:'Escaneo', consulta:'Consulta', cambio_ubicacion:'Cambio ubicación', transito:'Tránsito' }

  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc', fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{ background:'#0f172a', height:56, padding:'0 28px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#3b82f6"/>
            <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#3b82f6"/>
            <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#60a5fa"/>
            <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#60a5fa"/>
          </svg>
          <span style={{ color:'#f1f5f9', fontSize:15, fontWeight:700 }}>InventarioOps</span>
          <span style={{ color:'#334155', fontSize:12 }}>Dashboard global</span>
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          {user?.rol === 'admin' && <a href="/admin" style={{ fontSize:12, color:'#64748b', textDecoration:'none' }}>Admin</a>}
          <a href="/scanner" style={{ fontSize:12, color:'#3b82f6', textDecoration:'none', fontWeight:600 }}>📷 Escáner</a>
          <button onClick={logout} style={{ fontSize:11, color:'#64748b', background:'transparent', border:'none', cursor:'pointer' }}>Salir ({user?.username})</button>
        </div>
      </div>

      <div style={{ padding:'24px 28px', maxWidth:1100, margin:'0 auto' }}>

        {/* Último escaneo (flash) */}
        {lastScan && (
          <div style={{
            marginBottom:16, padding:'12px 16px', borderRadius:12,
            background: flash ? (STATUS_CFG[flash]?.bg || '#dcfce7') : '#fff',
            border:`1px solid ${flash ? (STATUS_CFG[flash]?.text || '#16a34a') : '#e2e8f0'}`,
            display:'flex', alignItems:'center', justifyContent:'space-between', transition:'all 0.5s'
          }}>
            <div>
              <div style={{ fontSize:10, fontWeight:600, color:'#94a3b8', marginBottom:2 }}>ÚLTIMO ESCANEO</div>
              <div style={{ fontFamily:'monospace', fontWeight:700, fontSize:15 }}>{lastScan.barcode}</div>
              {lastScan.cliente && <div style={{ fontSize:12, color:'#64748b' }}>{lastScan.cliente}</div>}
            </div>
            <Badge status={lastScan.status} />
          </div>
        )}

        {/* Métricas */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:10, marginBottom:20 }}>
          <Metric label="Total"          value={stats.total.toLocaleString()} color="#0f172a" />
          <Metric label="Pendientes"     value={stats.pendientes.toLocaleString()} color="#f59e0b" />
          <Metric label="Escaneadas"     value={stats.escaneadas.toLocaleString()} sub={`${pct}%`} color="#16a34a" />
          <Metric label="Tránsito Local" value={stats.transito_local.toLocaleString()} color="#1d4ed8" />
          <Metric label="Tránsito MTY"   value={stats.transito_mty.toLocaleString()} color="#6d28d9" />
          <Metric label="Desconocidas"   value={stats.desconocidas.toLocaleString()} color="#ef4444" />
          <Metric label="Abandono"       value={stats.abandonos.toLocaleString()} color="#b45309" />
        </div>

        {/* Panel carga de lista (supervisor+) */}
        {isSuper && (
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'16px 20px', marginBottom:20, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', marginBottom:4 }}>Lista de inventario — {today}</div>
              {listaStatus?.cargada
                ? <div style={{ fontSize:12, color:'#15803d' }}>✅ Cargada a las {listaStatus.hora} · {listaStatus.count} guías</div>
                : <div style={{ fontSize:12, color:'#f59e0b' }}>⏳ Sin cargar hoy</div>}
              {uploadMsg && <div style={{ fontSize:12, marginTop:4, color: uploadMsg.ok ? '#15803d' : '#b91c1c' }}>{uploadMsg.msg}</div>}
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" onChange={e => uploadLista(e.target.files[0])} style={{ display:'none' }} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                style={{ padding:'8px 16px', borderRadius:8, background: uploading?'#f1f5f9':'#1e40af', color: uploading?'#94a3b8':'#fff', border:'none', fontSize:13, fontWeight:600, cursor: uploading?'default':'pointer' }}>
                {uploading ? 'Cargando…' : listaStatus?.cargada ? '↺ Recargar lista' : '+ Cargar lista'}
              </button>
              <button onClick={exportar}
                style={{ padding:'8px 16px', borderRadius:8, background:'transparent', border:'1px solid #e2e8f0', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                ↓ Excel
              </button>
            </div>
          </div>
        )}

        {/* Tabla de guías */}
        <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, overflow:'hidden' }}>

          {/* Barra de búsqueda y filtros */}
          <div style={{ padding:'12px 16px', borderBottom:'1px solid #f1f5f9', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', flex:1, minWidth:200, gap:6 }}>
              <input
                ref={searchRef}
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
                placeholder="Buscar guía, cliente, destino…"
                style={{ flex:1, padding:'7px 10px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:13, outline:'none', background:'#f8fafc' }}
              />
              <button onClick={handleSearch}
                style={{ padding:'7px 14px', borderRadius:8, background:'#1e40af', color:'#fff', border:'none', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                Buscar
              </button>
              {search && (
                <button onClick={() => { setSearch(''); setSearchInput(''); loadGuias(1, filter, '') }}
                  style={{ padding:'7px 10px', borderRadius:8, background:'transparent', border:'1px solid #e2e8f0', color:'#94a3b8', fontSize:12, cursor:'pointer' }}>
                  ✕
                </button>
              )}
            </div>
            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
              {[['all','Todas'],['pendiente','Pend.'],['escaneada','Esc.'],['transito_local','T. Local'],['transito_mty','T. MTY'],['desconocida','Desc.'],['abandono','Aban.']].map(([v, l]) => (
                <button key={v} onClick={() => handleFilter(v)}
                  style={{
                    padding:'5px 10px', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer', border:'none',
                    background: filter===v ? '#0f172a' : '#f1f5f9',
                    color: filter===v ? '#f1f5f9' : '#64748b', transition:'all 0.15s'
                  }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Conteo */}
          <div style={{ padding:'6px 16px', background:'#fafafa', borderBottom:'1px solid #f1f5f9', fontSize:11, color:'#94a3b8' }}>
            {loading ? 'Cargando…' : `${total.toLocaleString()} guías${search ? ` · búsqueda: "${search}"` : ''}`}
          </div>

          {/* Tabla */}
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr>
                  {['Fecha ingreso','Guía','Destino','Cliente','Ubicación','Estatus','Proceso','Historial'].map(h => (
                    <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:'#94a3b8', fontWeight:600, fontSize:11, borderBottom:'1px solid #f1f5f9', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {guias.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign:'center', padding:48, color:'#cbd5e1' }}>
                    {loading ? 'Cargando…' : 'Sin guías'}
                  </td></tr>
                ) : guias.map(g => (
                  <tr key={g.id} style={{ borderBottom:'1px solid #f8fafc' }}>
                    <td style={{ padding:'9px 12px', color:'#94a3b8', whiteSpace:'nowrap' }}>
                      {g.dia_fecha ? new Date(g.dia_fecha).toLocaleDateString('es-MX') : '—'}
                    </td>
                    <td style={{ padding:'9px 12px', fontFamily:'monospace', fontWeight:700, whiteSpace:'nowrap' }}>{g.numero_guia}</td>
                    <td style={{ padding:'9px 12px', color:'#475569' }}>{g.destino || '—'}</td>
                    <td style={{ padding:'9px 12px', color:'#475569', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.cliente || '—'}</td>
                    <td style={{ padding:'9px 12px', fontFamily:'monospace', color:'#d97706', fontWeight:600 }}>{g.ubicacion || '—'}</td>
                    <td style={{ padding:'9px 12px' }}><Badge status={g.estatus} /></td>
                    <td style={{ padding:'9px 12px', color:'#94a3b8' }}>{g.proceso || '—'}</td>
                    <td style={{ padding:'9px 12px' }}>
                      <button onClick={() => verHistorial(g)}
                        style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:6, border:'1px solid #e2e8f0', background:'transparent', color:'#475569', cursor:'pointer' }}>
                        📋
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {total > 50 && (
            <div style={{ padding:'12px 16px', borderTop:'1px solid #f1f5f9', display:'flex', gap:6, justifyContent:'center', alignItems:'center' }}>
              <button onClick={() => handlePage(page-1)} disabled={page===1}
                style={{ padding:'6px 12px', borderRadius:8, border:'1px solid #e2e8f0', background:'transparent', color: page===1?'#cbd5e1':'#475569', cursor: page===1?'default':'pointer', fontSize:12 }}>
                ← Anterior
              </button>
              <span style={{ fontSize:12, color:'#64748b', padding:'0 8px' }}>Página {page} de {Math.ceil(total/50)}</span>
              <button onClick={() => handlePage(page+1)} disabled={page >= Math.ceil(total/50)}
                style={{ padding:'6px 12px', borderRadius:8, border:'1px solid #e2e8f0', background:'transparent', color: page>=Math.ceil(total/50)?'#cbd5e1':'#475569', cursor: page>=Math.ceil(total/50)?'default':'pointer', fontSize:12 }}>
                Siguiente →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal historial de guía */}
      {showHistorial && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}
          onClick={e => { if (e.target === e.currentTarget) setShowHistorial(false) }}>
          <div style={{ background:'#fff', borderRadius:14, width:480, maxWidth:'92vw', maxHeight:'80vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:14 }}>Historial de movimientos</div>
                <div style={{ fontSize:11, fontFamily:'monospace', color:'#64748b', marginTop:2 }}>{historialTarget?.numero_guia}</div>
              </div>
              <button onClick={() => setShowHistorial(false)}
                style={{ background:'#f1f5f9', border:'none', borderRadius:8, color:'#64748b', cursor:'pointer', fontSize:14, width:32, height:32 }}>×</button>
            </div>
            <div style={{ overflowY:'auto', flex:1 }}>
              {loadingHist ? (
                <div style={{ textAlign:'center', padding:32, color:'#94a3b8' }}>Cargando…</div>
              ) : historialGuia.length === 0 ? (
                <div style={{ textAlign:'center', padding:32, color:'#94a3b8', fontSize:13 }}>Sin movimientos registrados</div>
              ) : historialGuia.map((h, i) => (
                <div key={i} style={{ padding:'12px 20px', borderBottom:'1px solid #f8fafc', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:'#0f172a' }}>{TIPO_ES[h.tipo] || h.tipo}</div>
                    {h.detalle && <div style={{ fontSize:11, color:'#d97706', fontFamily:'monospace', marginTop:2 }}>{h.detalle}</div>}
                    {h.ubicacion && <div style={{ fontSize:11, color:'#1d4ed8', marginTop:2 }}>📍 {h.ubicacion}</div>}
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>👤 {h.usuario || '—'}</div>
                  </div>
                  <div style={{ fontSize:11, color:'#94a3b8', whiteSpace:'nowrap', textAlign:'right' }}>
                    {new Date(h.scanned_at).toLocaleDateString('es-MX')}<br/>
                    {new Date(h.scanned_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

const TIPO_ES = { escaneo:'Escaneo', consulta:'Consulta', cambio_ubicacion:'Cambio ubicación', transito:'Tránsito' }
