import { useState } from 'react'
import { createBook } from '../api/books'
import { t } from '../i18n'

const EMPTY = { baslik: '', yazar: '', isbn: '', isAvailable: true }

export default function AddBook({ onAdded, onAuthError, lang }) {
  const [form, setForm]     = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.baslik || !form.yazar || !form.isbn) {
      setError(t(lang, 'fieldRequired'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      await createBook(form)
      setForm(EMPTY)
      onAdded()
    } catch (err) {
      if (err.status === 401) { onAuthError?.(); return }
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>{t(lang, 'addManuallyTitle')}</h2>
      {error && <p style={{ color: 'var(--accent)', fontSize: '.875rem' }}>{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
        <input placeholder={t(lang, 'titlePlaceholder')}  value={form.baslik} onChange={e => set('baslik', e.target.value)} />
        <input placeholder={t(lang, 'authorPlaceholder')} value={form.yazar}  onChange={e => set('yazar', e.target.value)} />
        <input placeholder={t(lang, 'isbnPlaceholder')}   value={form.isbn}   onChange={e => set('isbn', e.target.value)} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? t(lang, 'adding') : t(lang, 'addBook')}
        </button>
      </div>
    </form>
  )
}
