import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ScannerTC22 from './pages/ScannerTC22'
import Admin from './pages/Admin'

function Router() {
  const { user, isAdmin } = useAuth()

  if (!user) return <Login />

  const path = window.location.pathname

  // Operador siempre va al scanner
  if (user.rol === 'operador') {
    if (path !== '/scanner') {
      window.location.pathname = '/scanner'
      return null
    }
    return <ScannerTC22 />
  }

  if (path === '/scanner') return <ScannerTC22 />
  if (path === '/admin' && isAdmin) return <Admin />
  if (path === '/admin' && !isAdmin) {
    window.location.pathname = '/'
    return null
  }
  return <Dashboard />
}

export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  )
}
