const BASE = '/books'

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (res.status === 401) throw Object.assign(new Error('Session expired. Please log in again.'), { status: 401 })
  if (res.status === 409) throw new Error('ISBN already exists in the library.')
  if (res.status === 404) throw new Error('Book not found.')
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) msg = body.detail
      else if (body?.title) msg = body.title
    } catch {}
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
}

export const getBooks   = (params = {}) => {
  const qs = new URLSearchParams({ pageSize: 1000, ...params }).toString()
  return request(`?${qs}`)
}
export const getBook    = (id)       => request(`/${id}`)
export const createBook = (book)     => request('', { method: 'POST', body: JSON.stringify(book) })
export const updateBook = (id, book) => request(`/${id}`, { method: 'PUT', body: JSON.stringify(book) })
export const deleteBook = (id)       => request(`/${id}`, { method: 'DELETE' })
export async function importBook(isbn) {
  const res = await fetch(`${BASE}/import/${isbn}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  if (res.status === 401) throw Object.assign(new Error('Session expired. Please log in again.'), { status: 401 })
  if (res.status === 409) throw new Error('ISBN already exists in the library.')
  if (res.status === 404) throw new Error(`ISBN ${isbn} was not found on Open Library.`)
  if (!res.ok) throw new Error(`Import failed (${res.status})`)
  return res.json()
}
