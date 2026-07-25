async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
  if (res.status === 204) return null
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = body?.detail || body?.title || body?.message || `Request failed (${res.status})`
    throw Object.assign(new Error(msg), { status: res.status })
  }
  return body
}

export const getHousehold      = ()       => request('/household')
export const createHousehold   = (name)   => request('/household',         { method: 'POST', body: JSON.stringify({ name }) })
export const generateInvite    = ()       => request('/household/invite',   { method: 'POST' })
export const joinHousehold     = (code)   => request('/household/join',     { method: 'POST', body: JSON.stringify({ code }) })
export const leaveHousehold    = ()       => request('/household/leave',    { method: 'DELETE' })
export const disbandHousehold  = ()       => request('/household',          { method: 'DELETE' })
export const removeMember      = (userId) => request(`/household/members/${userId}`, { method: 'DELETE' })
