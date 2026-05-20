import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!username || !password) return
    setLoading(true)
    setError('')
    try {
      await login(username, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0f172a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans','Segoe UI',sans-serif", padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>

        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:32 }}>
          <div style={{ width:40, height:40, borderRadius:10, background:'#1e40af', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#93c5fd"/>
              <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#93c5fd"/>
              <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#93c5fd"/>
              <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#60a5fa"/>
            </svg>
          </div>
          <div>
            <div style={{ color:'#f1f5f9', fontSize:18, fontWeight:700, lineHeight:1 }}>InventarioOps</div>
            <div style={{ color:'#475569', fontSize:12, marginTop:2 }}>Sistema de inventario</div>
          </div>
        </div>

        {/* Card */}
        <div style={{ background:'#1e293b', borderRadius:16, padding:28, border:'1px solid #334155' }}>
          <div style={{ fontSize:15, fontWeight:700, color:'#f1f5f9', marginBottom:4 }}>Iniciar sesión</div>
          <div style={{ fontSize:13, color:'#64748b', marginBottom:24 }}>Ingresa tus credenciales para continuar</div>

          {error && (
            <div style={{ background:'#450a0a', border:'1px solid #7f1d1d', borderRadius:8, padding:'10px 12px', marginBottom:16, fontSize:13, color:'#fca5a5' }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:11, fontWeight:600, color:'#64748b', display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.05em' }}>
              Usuario
            </label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoFocus
              autoComplete="username"
              placeholder="tu usuario"
              style={{
                width:'100%', padding:'10px 12px', borderRadius:8,
                border:'1px solid #334155', background:'#0f172a',
                color:'#f1f5f9', fontSize:14, outline:'none',
                transition:'border 0.15s'
              }}
              onFocus={e => e.target.style.border='1px solid #3b82f6'}
              onBlur={e => e.target.style.border='1px solid #334155'}
            />
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={{ fontSize:11, fontWeight:600, color:'#64748b', display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.05em' }}>
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoComplete="current-password"
              placeholder="••••••••"
              style={{
                width:'100%', padding:'10px 12px', borderRadius:8,
                border:'1px solid #334155', background:'#0f172a',
                color:'#f1f5f9', fontSize:14, outline:'none',
                transition:'border 0.15s'
              }}
              onFocus={e => e.target.style.border='1px solid #3b82f6'}
              onBlur={e => e.target.style.border='1px solid #334155'}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !username || !password}
            style={{
              width:'100%', padding:'11px', borderRadius:8, border:'none',
              background: loading || !username || !password ? '#1e293b' : '#1e40af',
              color: loading || !username || !password ? '#475569' : '#fff',
              fontSize:14, fontWeight:700, cursor: loading || !username || !password ? 'default':'pointer',
              transition:'all 0.15s'
            }}>
            {loading ? 'Verificando…' : 'Entrar'}
          </button>
        </div>

        {/* Rol hint */}
        <div style={{ marginTop:16, display:'flex', justifyContent:'center', gap:16 }}>
          {[['admin','#fee2e2','#b91c1c'],['supervisor','#dbeafe','#1d4ed8'],['operador','#f1f5f9','#475569']].map(([rol,bg,text])=>(
            <span key={rol} style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:99, background:bg, color:text }}>{rol}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
