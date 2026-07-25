export async function register({ name, email, password }) {
  const res = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, email, password }),
  })
  if (res.status === 409) throw new Error('CONFLICT')
  if (res.status === 400) {
    const msg = await res.json().catch(() => null)
    throw new Error(typeof msg === 'string' ? msg : 'INVALID_INPUT')
  }
  if (!res.ok) throw new Error(`REGISTER_FAILED`)
  return res.json()
}

export async function login({ name, password, rememberMe = false }) {
  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, password, rememberMe }),
  })
  if (res.status === 401) throw new Error('INVALID_CREDENTIALS')
  if (res.status === 403) throw new Error('EMAIL_NOT_VERIFIED')
  if (res.status === 429) throw new Error('ACCOUNT_LOCKED')
  if (!res.ok) throw new Error(`LOGIN_FAILED`)
  return res.json() // { userId, name, expiresAt }
}

export async function logout() {
  await fetch('/logout', { method: 'POST', credentials: 'include' })
}

export async function getMe() {
  const res = await fetch('/me', { credentials: 'include' })
  if (!res.ok) return null
  return res.json() // { userId, name }
}

export async function resendVerification({ email }) {
  const res = await fetch('/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error('RESEND_FAILED')
  return res.json()
}

export async function forgotPassword({ email }) {
  const res = await fetch('/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error('FORGOT_FAILED')
  return res.json()
}
