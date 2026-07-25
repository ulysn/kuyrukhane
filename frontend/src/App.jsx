import { useEffect, useState } from 'react'
import { getBooks } from './api/books'
import { getMe, logout } from './api/auth'
import BookList  from './components/BookList'
import AddBook   from './components/AddBook'
import Scanner   from './components/Scanner'
import Household from './components/Household'
import Login     from './components/Login'
import { t }    from './i18n'

export default function App() {
  const [user, setUser]       = useState(null)   // { userId, name } or null
  const [authLoading, setAuthLoading] = useState(true)
  const [lang, setLang]       = useState(() => localStorage.getItem('lang')  || 'tr')
  const [theme, setTheme]     = useState(() => localStorage.getItem('theme') || 'light')
  const [tab, setTab]         = useState('books')
  const [books, setBooks]     = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery]     = useState('')

  const TABS = [
    { key: 'books',     label: t(lang, 'tabBooks')  },
    { key: 'scan',      label: t(lang, 'tabScan')   },
    { key: 'manual',    label: t(lang, 'tabManual') },
    { key: 'household', label: t(lang, 'tabFamily') },
  ]

  useEffect(() => {
    getMe().then(me => {
      setUser(me)
      setAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    const meta = document.getElementById('theme-color-meta')
    if (meta) meta.content = theme === 'dark' ? '#0f0f1a' : '#1a1a2e'
  }, [theme])

  function toggleLang() {
    const next = lang === 'tr' ? 'en' : 'tr'
    localStorage.setItem('lang', next)
    setLang(next)
  }

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  function handleLogin(userData) {
    setUser(userData)
  }

  async function handleLogout() {
    await logout()
    setUser(null)
    setBooks([])
  }

  async function loadBooks() {
    setLoading(true)
    try {
      const data = await getBooks()
      setBooks(data.items ?? [])
    } catch (e) {
      if (e.status === 401) { handleLogout(); return }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) loadBooks()
    else setLoading(false)
  }, [user])

  function handleAdded() {
    loadBooks()
    setTab('books')
  }

  if (authLoading) return null

  if (!user) return <Login onLogin={handleLogin} lang={lang} toggleLang={toggleLang} theme={theme} toggleTheme={toggleTheme} />

  const filtered = books.filter(b =>
    [b.baslik, b.yazar, b.isbn].some(v => v?.toLowerCase().includes(query.toLowerCase()))
  )

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.5rem 0' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--primary)' }}>Family Library</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>{t(lang, 'books', books.length)}</span>
          <button className="btn-ghost" onClick={toggleTheme} style={{ fontSize: '.8rem', padding: '.3rem .7rem' }}>
            {theme === 'light' ? t(lang, 'darkMode') : t(lang, 'lightMode')}
          </button>
          <button className="btn-ghost" onClick={toggleLang} style={{ fontSize: '.8rem', padding: '.3rem .7rem' }}>
            {lang === 'tr' ? 'EN' : 'TR'}
          </button>
          <button className="btn-ghost" onClick={handleLogout} style={{ fontSize: '.8rem', padding: '.3rem .7rem' }}>
            {t(lang, 'logout')}
          </button>
        </div>
      </header>

      <nav style={{ display: 'flex', gap: '.4rem', background: 'var(--surface)', padding: '.4rem', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1, padding: '.5rem', fontSize: '.85rem', borderRadius: '8px',
              background: tab === key ? 'var(--accent)' : 'transparent',
              color:      tab === key ? '#fff' : 'var(--muted)',
              fontWeight: tab === key ? 700 : 500,
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'books' && (
        <>
          <input
            placeholder={t(lang, 'searchPlaceholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ background: 'var(--surface)' }}
          />
          {loading
            ? <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>{t(lang, 'loading')}</p>
            : <BookList books={filtered} onChanged={loadBooks} lang={lang} />
          }
        </>
      )}

      {tab === 'scan'      && <Scanner   onImported={handleAdded} onAuthError={handleLogout} lang={lang} />}
      {tab === 'manual'    && <AddBook   onAdded={handleAdded}   onAuthError={handleLogout} lang={lang} />}
      {tab === 'household' && <Household userId={user.userId}    onAuthError={handleLogout} lang={lang} />}
    </div>
  )
}
