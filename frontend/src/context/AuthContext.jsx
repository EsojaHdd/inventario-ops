import { createContext, useContext, useState, useCallback } from 'react'

const AuthContext = createContext(null)

const API = '/api'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem('inventario_user')
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })
  const [token, setToken] = useState(() => sessionStorage.getItem('inventario_token') || null)

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión')
    setUser(data.user)
    setToken(data.token)
    sessionStorage.setItem('inventario_user', JSON.stringify(data.user))
    sessionStorage.setItem('inventario_token', data.token)
    return data.user
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    setToken(null)
    sessionStorage.removeItem('inventario_user')
    sessionStorage.removeItem('inventario_token')
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAdmin: user?.rol === 'admin', isSupervisor: ['admin','supervisor'].includes(user?.rol) }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
