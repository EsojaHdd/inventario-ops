import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useApi } from '../hooks/useApi'

const API = '/api'

const ROLES = {
  admin:      { label:'Admin',      bg:'#fee2e2', text:'#b91c1c' },
  supervisor: { label:'Supervisor', bg:'#dbeafe', text:'#1d4ed8' },
  operador:   { label:'Operador',   bg:'#f1f5f9', text:'#475569' },
}

function Section({ title, children }) {
  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, overflow:'hidden', marginBottom:16 }}>
      <div style={{ padding:'12px 20px', borderBottom:'1px solid #f1f5f9', fontSize:14, fontWeight:700, color:'#0f172a' }}>{title}</div>
      <div style={{ padding:'16px 20px' }}>{children}</div>
    </div>
  )
}

function Badge({ rol }) {
  const c = ROLES[rol] || ROLES.operador
  return <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:99, background:c.bg, color:c.text }}>{c.label}</span>
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'#fff', borderRadius:14, padding:24, width:360, maxWidth:'90vw', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <span style={{ fontWeight:700, fontSize:15 }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:18 }}>x</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormInput({ label, value, onChange, placeholder, type = 'text', autoFocus = false }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ fontSize:11, fontWeight:600, color:'#64748b', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.04em' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:13, background:'#f8fafc', outline:'none' }}
      />
    </div>
  )
}

function FormSelect({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ fontSize:11, fontWeight:600, color:'#64748b', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.04em' }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:13, background:'#f8fafc', outline:'none', cursor:'pointer' }}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

function Btn({ children, onClick, variant = 'primary', disabled }) {
  const styles = {
    primary:   { bg:'#1e40af',     color:'#fff',     border:'none' },
    danger:    { bg:'#fee2e2',     color:'#b91c1c',  border:'1px solid #fca5a5' },
    secondary: { bg:'transparent', color:'#64748b',  border:'1px solid #e2e8f0' },
    warning:   { bg:'#fef3c7',     color:'#b45309',  border:'1px solid #fcd34d' },
  }
  const s = styles[variant] || styles.primary
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding:'8px 16px', borderRadius:8, fontSize:13, fontWeight:600,
        cursor: disabled ? 'default' : 'pointer',
        background: disabled ? '#f1f5f9' : s.bg,
        color: disabled ? '#94a3b8' : s.color,
        border: s.border, transition:'all 0.15s'
      }}
    >{children}</button>
  )
}


function UbicacionRow({ u, onDelete, onSaveEtiqueta }) {
  const [editando, setEditando] = useState(false)
  const [etiqueta, setEtiqueta] = useState(u.etiqueta || '')
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    setGuardando(true)
    await onSaveEtiqueta(etiqueta)
    setGuardando(false)
    setEditando(false)
  }

  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background: u.activa?'#f8fafc':'#fef2f2', border:`1px solid ${u.activa?'#e2e8f0':'#fca5a5'}`, borderRadius:10 }}>
      <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:800, color:'#d97706', minWidth:64 }}>{u.codigo}</span>
      {editando ? (
        <>
          <input
            value={etiqueta}
            onChange={e => setEtiqueta(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false) }}
            placeholder="Nombre descriptivo..."
            autoFocus
            style={{ flex:1, padding:'4px 8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:12, outline:'none' }}
          />
          <button onClick={guardar} disabled={guardando} style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:6, border:'none', background:'#1e40af', color:'#fff', cursor:'pointer' }}>
            {guardando ? '...' : 'OK'}
          </button>
          <button onClick={() => setEditando(false)} style={{ fontSize:11, padding:'3px 8px', borderRadius:6, border:'1px solid #e2e8f0', background:'transparent', color:'#94a3b8', cursor:'pointer' }}>
            ×
          </button>
        </>
      ) : (
        <>
          <span
            onClick={() => setEditando(true)}
            style={{ flex:1, fontSize:12, color: u.etiqueta?'#475569':'#cbd5e1', cursor:'pointer', fontStyle: u.etiqueta?'normal':'italic' }}>
            {u.etiqueta || 'Sin etiqueta — click para agregar'}
          </span>
          <button onClick={() => setEditando(true)} style={{ fontSize:11, color:'#94a3b8', background:'transparent', border:'1px solid #e2e8f0', borderRadius:6, padding:'2px 8px', cursor:'pointer' }}>✎</button>
          <button onClick={onDelete} style={{ background:'none', border:'none', cursor:'pointer', color:'#fca5a5', fontSize:14, lineHeight:1, padding:'0 2px' }}>×</button>
        </>
      )}
    </div>
  )
}

export default function Admin() {
  const { user, logout } = useAuth()
  const { apiFetch }     = useApi()

  const [tab, setTab]               = useState('usuarios')
  const [usuarios, setUsuarios]     = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [loading, setLoading]       = useState(false)
  const [modal, setModal]           = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [nuevoUser, setNuevoUser]   = useState({ username:'', password:'', rol:'operador' })
  const [nuevaUbic, setNuevaUbic]   = useState({ zona:'', rack:'', nivel:'' })
  const [cambioPass, setCambioPass] = useState({ userId:null, username:'', password:'', confirm:'' })

  // Mantenimiento
  const [mOpcion, setMOpcion]           = useState('1')
  const [mRango, setMRango]             = useState('4semanas')
  const [mPreview, setMPreview]         = useState(null)
  const [mLoadingPrev, setMLoadingPrev] = useState(false)
  const [mConfirm, setMConfirm]         = useState('')
  const [mEjecutando, setMEjecutando]   = useState(false)
  const [mMensaje, setMMensaje]         = useState(null)
  const [mDescargando, setMDescargando] = useState(false)

  const loadUsuarios = useCallback(async () => {
    const r = await apiFetch(`${API}/admin/usuarios`).then(x => x?.json()).catch(() => [])
    setUsuarios(Array.isArray(r) ? r : [])
  }, [apiFetch])

  const loadUbicaciones = useCallback(async () => {
    const r = await apiFetch(`${API}/ubicaciones`).then(x => x?.json()).catch(() => [])
    setUbicaciones(Array.isArray(r) ? r : [])
  }, [apiFetch])

  useEffect(() => { loadUsuarios(); loadUbicaciones() }, [loadUsuarios, loadUbicaciones])

  const crearUsuario = async () => {
    if (!nuevoUser.username || !nuevoUser.password) return
    setLoading(true)
    await apiFetch(`${API}/admin/usuarios`, { method:'POST', body:JSON.stringify(nuevoUser) })
    setNuevoUser({ username:'', password:'', rol:'operador' })
    setModal(null)
    await loadUsuarios()
    setLoading(false)
  }

  const toggleUser = async (id, activo) => {
    await apiFetch(`${API}/admin/usuarios/${id}`, { method:'PATCH', body:JSON.stringify({ activo:!activo }) })
    loadUsuarios()
  }

  const cambiarPassword = async () => {
    if (!cambioPass.password || cambioPass.password !== cambioPass.confirm) return
    setLoading(true)
    await apiFetch(`${API}/admin/usuarios/${cambioPass.userId}/password`, {
      method:'PATCH',
      body: JSON.stringify({ password: cambioPass.password })
    })
    setCambioPass({ userId:null, username:'', password:'', confirm:'' })
    setLoading(false)
  }

  const crearUbicacion = async () => {
    const { zona, rack, nivel } = nuevaUbic
    if (!zona || !rack || !nivel) return
    const codigo = `${zona}-${rack}-${nivel}`.toUpperCase()
    setLoading(true)
    await apiFetch(`${API}/ubicaciones`, { method:'POST', body:JSON.stringify({ codigo, zona, rack, nivel }) })
    setNuevaUbic({ zona:'', rack:'', nivel:'' })
    setModal(null)
    await loadUbicaciones()
    setLoading(false)
  }

  const eliminarUbicacion = async (id) => {
    await apiFetch(`${API}/ubicaciones/${id}`, { method:'DELETE' })
    setConfirmDel(null)
    loadUbicaciones()
  }

  // Mantenimiento
  const descargarHistorico = async () => {
    setMDescargando(true)
    try {
      const token = sessionStorage.getItem('inventario_token')
      const res = await fetch(`${API}/historico`, { headers: { Authorization: `Bearer ${token}` } })
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `historico_${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch { setMMensaje({ ok:false, txt:'Error al descargar el historico' }) }
    finally { setMDescargando(false) }
  }

  const cargarPreview = async () => {
    setMLoadingPrev(true)
    setMPreview(null)
    setMConfirm('')
    setMMensaje(null)
    const r = await apiFetch(`${API}/mantenimiento/preview?opcion=${mOpcion}&rango=${mRango}`).then(x => x?.json()).catch(() => null)
    setMPreview(r)
    setMLoadingPrev(false)
  }

  const ejecutarBorrado = async () => {
    if (mConfirm !== 'CONFIRMAR') return
    setMEjecutando(true)
    const r = await apiFetch(`${API}/mantenimiento/ejecutar`, {
      method: 'POST',
      body: JSON.stringify({ opcion: mOpcion, rango: mRango, confirmacion: mConfirm })
    }).then(x => x?.json()).catch(() => null)
    if (r?.ok) {
      setMMensaje({ ok:true, txt:'Borrado completado correctamente.' })
      setMPreview(null)
      setMConfirm('')
    } else {
      setMMensaje({ ok:false, txt: r?.error || 'Error al ejecutar el borrado.' })
    }
    setMEjecutando(false)
  }

  const zonas = ubicaciones.reduce((acc, u) => {
    if (!acc[u.zona]) acc[u.zona] = []
    acc[u.zona].push(u)
    return acc
  }, {})

  const OPCIONES_DESC = {
    '1': { titulo:'Solo log de movimientos', desc:'Borra el historial de escaneos del rango seleccionado. Las guias conservan su estatus, ubicacion y conteos. El dashboard no cambia.', color:'#1d4ed8', bg:'#dbeafe' },
    '2': { titulo:'Movimientos + Guias antiguas', desc:'Borra guias completas (con sus escaneos) de dias anteriores al corte. El dashboard perdera conteos historicos de esos dias.', color:'#b45309', bg:'#fef3c7' },
    '3': { titulo:'Reset total', desc:'Borra absolutamente todo: escaneos, guias y dias de operacion. El dashboard queda en ceros. Maximo espacio liberado.', color:'#b91c1c', bg:'#fee2e2' },
  }

  const RANGOS_DESC = {
    'todo':     'Todo (sin limite de fecha)',
    '1semana':  'Anteriores a 1 semana',
    '4semanas': 'Anteriores a 4 semanas',
  }

  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc', fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{ background:'#0f172a', height:56, padding:'0 28px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#3b82f6"/>
            <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#3b82f6"/>
            <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#60a5fa"/>
            <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#60a5fa"/>
          </svg>
          <span style={{ color:'#f1f5f9', fontSize:15, fontWeight:700 }}>InventarioOps</span>
          <span style={{ color:'#334155', fontSize:13 }}>/ Administracion</span>
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <a href="/" style={{ fontSize:12, color:'#64748b', textDecoration:'none' }}>Dashboard</a>
          <button onClick={logout} style={{ fontSize:11, color:'#64748b', background:'transparent', border:'none', cursor:'pointer' }}>Salir ({user?.username})</button>
        </div>
      </div>

      <div style={{ padding:'24px 28px', maxWidth:900, margin:'0 auto' }}>

        {/* Tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:20, background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, padding:4, width:'fit-content' }}>
          {[['usuarios','Usuarios'],['ubicaciones','Ubicaciones'],['mantenimiento','Mantenimiento']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding:'7px 20px', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', border:'none',
              background: tab===k ? '#0f172a' : 'transparent',
              color: tab===k ? '#f1f5f9' : '#64748b', transition:'all 0.15s'
            }}>{l}</button>
          ))}
        </div>

        {/* Tab Usuarios */}
        {tab === 'usuarios' && (
          <Section title={
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span>Usuarios ({usuarios.length})</span>
              <Btn onClick={() => setModal('nuevo-user')}>+ Nuevo usuario</Btn>
            </div>
          }>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  {['Usuario','Rol','Estado','Creado','Acciones'].map(h => (
                    <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:'#94a3b8', fontWeight:600, fontSize:11, borderBottom:'1px solid #f1f5f9' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usuarios.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign:'center', padding:32, color:'#cbd5e1', fontSize:13 }}>Sin usuarios registrados</td></tr>
                ) : usuarios.map((u) => (
                  <tr key={u.id} style={{ borderBottom:'1px solid #f8fafc' }}>
                    <td style={{ padding:'10px 12px', fontWeight:600 }}>{u.username}</td>
                    <td style={{ padding:'10px 12px' }}><Badge rol={u.rol} /></td>
                    <td style={{ padding:'10px 12px' }}>
                      <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:99, background:u.activo?'#dcfce7':'#fee2e2', color:u.activo?'#15803d':'#b91c1c' }}>
                        {u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td style={{ padding:'10px 12px', fontSize:12, color:'#94a3b8' }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('es-MX') : '-'}
                    </td>
                    <td style={{ padding:'10px 12px' }}>
                      <div style={{ display:'flex', gap:6 }}>
                        <button
                          onClick={() => setCambioPass({ userId:u.id, username:u.username, password:'', confirm:'' })}
                          style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:8, cursor:'pointer', border:'1px solid #bfdbfe', background:'#eff6ff', color:'#1e40af' }}>
                          Contrasena
                        </button>
                        <button
                          onClick={() => toggleUser(u.id, u.activo)}
                          style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:8, cursor:'pointer', border:'1px solid #e2e8f0', background:'transparent', color: u.activo?'#b91c1c':'#16a34a' }}>
                          {u.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}


        {/* Tab Ubicaciones */}
        {tab === 'ubicaciones' && (
          <Section title={
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span>Ubicaciones ({ubicaciones.length})</span>
              <Btn onClick={() => setModal('nueva-ubic')}>+ Nueva ubicacion</Btn>
            </div>
          }>
            {Object.keys(zonas).length === 0 ? (
              <div style={{ textAlign:'center', padding:32, color:'#cbd5e1', fontSize:13 }}>Sin ubicaciones. Crea la primera.</div>
            ) : Object.entries(zonas).sort().map(([zona, items]) => (
              <div key={zona} style={{ marginBottom:20 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Zona {zona}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {items.sort((a, b) => a.codigo.localeCompare(b.codigo)).map((u) => (
                    <UbicacionRow key={u.id} u={u} onDelete={() => setConfirmDel(u)} onSaveEtiqueta={async (etiqueta) => {
                      await apiFetch(`${API}/ubicaciones/${u.id}`, { method:'PATCH', body: JSON.stringify({ etiqueta }) })
                      loadUbicaciones()
                    }} />
                  ))}
                </div>
              </div>
            ))}
          </Section>
        )}


        {/* Tab Mantenimiento */}
        {tab === 'mantenimiento' && (
          <>
            {/* Descargar historico */}
            <Section title="Descargar historico completo">
              <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
                Exporta un Excel con 3 hojas: todas las guias, el log completo de movimientos, y el resumen de actividad por operador.
                Se recomienda descargar antes de ejecutar cualquier borrado.
              </p>
              <Btn onClick={descargarHistorico} disabled={mDescargando}>
                {mDescargando ? 'Descargando...' : '↓ Descargar historico Excel'}
              </Btn>
            </Section>

            {/* Borrado */}
            <Section title="Limpieza de base de datos">
              <p style={{ fontSize:13, color:'#64748b', marginBottom:20 }}>
                Selecciona que borrar y el rango de fechas. Revisa el preview antes de confirmar. Esta accion es irreversible.
              </p>

              {/* Selector de opcion */}
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:8 }}>Que borrar</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {Object.entries(OPCIONES_DESC).map(([k, v]) => (
                    <div key={k}
                      onClick={() => { setMOpcion(k); setMPreview(null); setMConfirm(''); setMMensaje(null) }}
                      style={{
                        padding:'12px 16px', borderRadius:10, cursor:'pointer',
                        border: `2px solid ${mOpcion===k ? v.color : '#e2e8f0'}`,
                        background: mOpcion===k ? v.bg : '#f8fafc',
                        transition:'all 0.15s'
                      }}>
                      <div style={{ fontSize:13, fontWeight:700, color: mOpcion===k ? v.color : '#0f172a' }}>{k}. {v.titulo}</div>
                      <div style={{ fontSize:12, color:'#64748b', marginTop:3 }}>{v.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Selector de rango */}
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:8 }}>Rango</div>
                <div style={{ display:'flex', gap:8 }}>
                  {Object.entries(RANGOS_DESC).map(([k, l]) => (
                    <button key={k}
                      onClick={() => { setMRango(k); setMPreview(null); setMConfirm(''); setMMensaje(null) }}
                      style={{
                        flex:1, padding:'9px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer',
                        border: `2px solid ${mRango===k ? '#0f172a' : '#e2e8f0'}`,
                        background: mRango===k ? '#0f172a' : '#f8fafc',
                        color: mRango===k ? '#fff' : '#64748b', transition:'all 0.15s'
                      }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Boton preview */}
              <div style={{ marginBottom:16 }}>
                <Btn onClick={cargarPreview} disabled={mLoadingPrev} variant="secondary">
                  {mLoadingPrev ? 'Calculando...' : 'Ver cuantos registros se borraran'}
                </Btn>
              </div>

              {/* Preview */}
              {mPreview && (
                <div style={{ background:'#fff7ed', border:'2px solid #fcd34d', borderRadius:10, padding:'14px 16px', marginBottom:16 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#b45309', marginBottom:10 }}>
                    Registros que se borraran{mPreview.fechaCorte ? ` (anteriores al ${mPreview.fechaCorte})` : ' (TODOS)'}:
                  </div>
                  <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                    <div style={{ fontSize:13, color:'#0f172a' }}>
                      <span style={{ fontWeight:700, fontSize:18 }}>{mPreview.escaneos.toLocaleString()}</span>
                      <span style={{ color:'#64748b', marginLeft:4 }}>escaneos</span>
                    </div>
                    {mPreview.guias > 0 && (
                      <div style={{ fontSize:13, color:'#0f172a' }}>
                        <span style={{ fontWeight:700, fontSize:18 }}>{mPreview.guias.toLocaleString()}</span>
                        <span style={{ color:'#64748b', marginLeft:4 }}>guias</span>
                      </div>
                    )}
                    {mPreview.dias > 0 && (
                      <div style={{ fontSize:13, color:'#0f172a' }}>
                        <span style={{ fontWeight:700, fontSize:18 }}>{mPreview.dias.toLocaleString()}</span>
                        <span style={{ color:'#64748b', marginLeft:4 }}>dias de operacion</span>
                      </div>
                    )}
                  </div>

                  {(mPreview.escaneos + mPreview.guias + mPreview.dias) === 0 ? (
                    <div style={{ fontSize:12, color:'#15803d', marginTop:10, fontWeight:600 }}>
                      No hay registros para borrar con esta configuracion.
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize:12, color:'#b45309', marginTop:12, marginBottom:8 }}>
                        Escribe CONFIRMAR para ejecutar el borrado:
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <input
                          value={mConfirm}
                          onChange={e => setMConfirm(e.target.value)}
                          placeholder="CONFIRMAR"
                          style={{ padding:'8px 12px', borderRadius:8, border:`2px solid ${mConfirm==='CONFIRMAR'?'#ef4444':'#fcd34d'}`, fontSize:13, fontFamily:'monospace', fontWeight:700, background:'#fff', outline:'none', width:160 }}
                        />
                        <button
                          onClick={ejecutarBorrado}
                          disabled={mConfirm !== 'CONFIRMAR' || mEjecutando}
                          style={{
                            padding:'8px 20px', borderRadius:8, fontSize:13, fontWeight:700, border:'none', cursor: mConfirm==='CONFIRMAR' && !mEjecutando ? 'pointer' : 'default',
                            background: mConfirm==='CONFIRMAR' && !mEjecutando ? '#ef4444' : '#f1f5f9',
                            color: mConfirm==='CONFIRMAR' && !mEjecutando ? '#fff' : '#94a3b8',
                            transition:'all 0.15s'
                          }}>
                          {mEjecutando ? 'Borrando...' : 'Ejecutar borrado'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Mensaje resultado */}
              {mMensaje && (
                <div style={{ padding:'12px 16px', borderRadius:10, background: mMensaje.ok?'#dcfce7':'#fee2e2', border:`1px solid ${mMensaje.ok?'#86efac':'#fca5a5'}`, fontSize:13, fontWeight:600, color: mMensaje.ok?'#15803d':'#b91c1c' }}>
                  {mMensaje.ok ? 'Borrado completado correctamente.' : mMensaje.txt}
                </div>
              )}
            </Section>

            {/* Permisos */}
            <Section title="Permisos por rol">
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
                {[
                  { rol:'operador',   permisos:['Escanear guias','Modo consulta','Modo estacion fija','Ver ubicacion al escanear','Mandar a transito local y MTY'] },
                  { rol:'supervisor', permisos:['Todo del operador','Cargar lista de inventario','Ver dashboard completo','Exportar reporte Excel'] },
                  { rol:'admin',      permisos:['Todo del supervisor','Crear y desactivar usuarios','Cambiar contrasenas','Crear y eliminar ubicaciones','Cerrar guias como abandono','Descargar historico completo','Limpieza de base de datos'] },
                ].map(({ rol, permisos }) => (
                  <div key={rol} style={{ background:'#f8fafc', borderRadius:10, padding:'12px 14px' }}>
                    <Badge rol={rol} />
                    <ul style={{ marginTop:10, paddingLeft:0, listStyle:'none', display:'flex', flexDirection:'column', gap:5 }}>
                      {permisos.map(p => (
                        <li key={p} style={{ fontSize:12, color:'#475569', display:'flex', alignItems:'flex-start', gap:6 }}>
                          <span style={{ color:'#22c55e', fontSize:10, marginTop:2 }}>v</span>{p}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}

      </div>

      {/* Modal nuevo usuario */}
      {modal === 'nuevo-user' && (
        <Modal title="Nuevo usuario" onClose={() => setModal(null)}>
          <FormInput label="Usuario" value={nuevoUser.username} onChange={v => setNuevoUser(p => ({...p, username:v}))} placeholder="ej: jgarcia" autoFocus />
          <FormInput label="Contrasena" type="password" value={nuevoUser.password} onChange={v => setNuevoUser(p => ({...p, password:v}))} placeholder="Minimo 6 caracteres" />
          <FormSelect label="Rol" value={nuevoUser.rol} onChange={v => setNuevoUser(p => ({...p, rol:v}))}
            options={[['operador','Operador'],['supervisor','Supervisor'],['admin','Admin']]} />
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:4 }}>
            <Btn variant="secondary" onClick={() => setModal(null)}>Cancelar</Btn>
            <Btn onClick={crearUsuario} disabled={loading || !nuevoUser.username || !nuevoUser.password}>Crear usuario</Btn>
          </div>
        </Modal>
      )}

      {/* Modal nueva ubicacion */}
      {modal === 'nueva-ubic' && (
        <Modal title="Nueva ubicacion" onClose={() => setModal(null)}>
          <div style={{ background:'#f8fafc', borderRadius:8, padding:'10px 12px', marginBottom:14, fontSize:12, color:'#64748b' }}>
            Formato: <strong style={{ fontFamily:'monospace', color:'#d97706' }}>{nuevaUbic.zona||'B'}-{nuevaUbic.rack||'A'}-{nuevaUbic.nivel||'3'}</strong>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            {[['zona','Zona','B'],['rack','Rack','A'],['nivel','Nivel','3']].map(([k, l, p]) => (
              <div key={k}>
                <label style={{ fontSize:11, fontWeight:600, color:'#64748b', display:'block', marginBottom:4 }}>{l}</label>
                <input
                  value={nuevaUbic[k]}
                  onChange={e => setNuevaUbic(v => ({...v, [k]: e.target.value.toUpperCase()}))}
                  placeholder={p}
                  maxLength={3}
                  style={{ width:'100%', padding:'8px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:14, fontFamily:'monospace', fontWeight:700, textAlign:'center', background:'#f8fafc', outline:'none', textTransform:'uppercase' }}
                />
              </div>
            ))}
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:16 }}>
            <Btn variant="secondary" onClick={() => setModal(null)}>Cancelar</Btn>
            <Btn onClick={crearUbicacion} disabled={loading || !nuevaUbic.zona || !nuevaUbic.rack || !nuevaUbic.nivel}>Crear ubicacion</Btn>
          </div>
        </Modal>
      )}

      {/* Modal cambiar contrasena */}
      {cambioPass.userId && (
        <Modal title={`Cambiar contrasena - ${cambioPass.username}`} onClose={() => setCambioPass({ userId:null, username:'', password:'', confirm:'' })}>
          <FormInput label="Nueva contrasena" type="password" value={cambioPass.password}
            onChange={v => setCambioPass(p => ({...p, password:v}))} placeholder="Minimo 6 caracteres" autoFocus />
          <FormInput label="Confirmar contrasena" type="password" value={cambioPass.confirm}
            onChange={v => setCambioPass(p => ({...p, confirm:v}))} placeholder="Repite la contrasena" />
          {cambioPass.password && cambioPass.confirm && cambioPass.password !== cambioPass.confirm && (
            <div style={{ fontSize:12, color:'#b91c1c', marginBottom:12 }}>Las contrasenas no coinciden</div>
          )}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
            <Btn variant="secondary" onClick={() => setCambioPass({ userId:null, username:'', password:'', confirm:'' })}>Cancelar</Btn>
            <Btn onClick={cambiarPassword} disabled={loading || !cambioPass.password || cambioPass.password !== cambioPass.confirm}>
              {loading ? 'Guardando...' : 'Guardar'}
            </Btn>
          </div>
        </Modal>
      )}

      {/* Confirm eliminar ubicacion */}
      {confirmDel && (
        <Modal title="Eliminar ubicacion" onClose={() => setConfirmDel(null)}>
          <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
            Eliminar la ubicacion <strong style={{ fontFamily:'monospace', color:'#d97706' }}>{confirmDel.codigo}</strong>?
            {' '}Las guias asignadas ahi quedaran sin ubicacion.
          </p>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
            <Btn variant="secondary" onClick={() => setConfirmDel(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={() => eliminarUbicacion(confirmDel.id)}>Eliminar</Btn>
          </div>
        </Modal>
      )}

    </div>
  )
}
