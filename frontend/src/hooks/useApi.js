import { useAuth } from '../context/AuthContext'
import { useCallback } from 'react'

export function useApi() {
  const { token, logout } = useAuth()

  const apiFetch = useCallback(async (url, options = {}) => {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
    if (res.status === 401) { logout(); return null }
    return res
  }, [token, logout])

  const apiFormData = useCallback(async (url, formData) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: formData,
    })
    if (res.status === 401) { logout(); return null }
    return res
  }, [token, logout])

  return { apiFetch, apiFormData }
}
