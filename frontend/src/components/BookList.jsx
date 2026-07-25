import { useState } from 'react'
import { deleteBook, updateBook } from '../api/books'
import { t } from '../i18n'

export default function BookList({ books, onChanged, lang }) {
  const [editing, setEditing] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  async function handleDelete(id) {
    if (!confirm(t(lang, 'confirmDelete'))) return
    try {
      await deleteBook(id)
      onChanged()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleSave(book) {
    setSaving(true)
    setError(null)
    try {
      await updateBook(book.id, book)
      setEditing(null)
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!books.length)
    return <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>{t(lang, 'noBooks')}</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
      {error && <p style={{ color: 'var(--accent)' }}>{error}</p>}
      {books.map(book =>
        editing?.id === book.id
          ? <EditRow key={book.id} book={editing} onChange={setEditing} onSave={handleSave} onCancel={() => setEditing(null)} saving={saving} lang={lang} />
          : <BookRow key={book.id} book={book} onEdit={() => setEditing({ ...book })} onDelete={() => handleDelete(book.id)} lang={lang} />
      )}
    </div>
  )
}

function BookRow({ book, onEdit, onDelete, lang }) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, marginBottom: '.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.baslik}</div>
        <div style={{ fontSize: '.85rem', color: 'var(--muted)' }}>{book.yazar} &middot; {book.isbn}</div>
      </div>
      <span className={`badge ${book.isAvailable ? 'badge-available' : 'badge-unavailable'}`}>
        {book.isAvailable ? t(lang, 'available') : t(lang, 'checkedOut')}
      </span>
      <div style={{ display: 'flex', gap: '.4rem' }}>
        <button className="btn-ghost"   onClick={onEdit}>  {t(lang, 'edit')}   </button>
        <button className="btn-danger"  onClick={onDelete}> {t(lang, 'delete')} </button>
      </div>
    </div>
  )
}

function EditRow({ book, onChange, onSave, onCancel, saving, lang }) {
  const set = (field, value) => onChange(prev => ({ ...prev, [field]: value }))

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
        <input placeholder={t(lang, 'titleField')}  value={book.baslik}      onChange={e => set('baslik', e.target.value)} />
        <input placeholder={t(lang, 'authorField')} value={book.yazar}       onChange={e => set('yazar', e.target.value)} />
        <input placeholder="ISBN"                    value={book.isbn}        onChange={e => set('isbn', e.target.value)} />
        <select value={book.isAvailable} onChange={e => set('isAvailable', e.target.value === 'true')}>
          <option value="true">{t(lang, 'available')}</option>
          <option value="false">{t(lang, 'checkedOut')}</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
        <button className="btn-secondary" onClick={onCancel}>{t(lang, 'cancel')}</button>
        <button className="btn-primary"   onClick={() => onSave(book)} disabled={saving}>
          {saving ? t(lang, 'saving') : t(lang, 'save')}
        </button>
      </div>
    </div>
  )
}
