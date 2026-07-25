import { useState } from 'react'
import { login, register, resendVerification, forgotPassword } from '../api/auth'
import { t } from '../i18n'

function PasswordInput({ placeholder, value, onChange, autoFocus, lang }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoFocus={autoFocus}
        required
        style={{ flex: 1, paddingRight: '4rem' }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        style={{
          position: 'absolute', right: '.6rem',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '.78rem', color: 'var(--muted)', padding: '.25rem',
        }}
      >
        {show ? t(lang, 'hidePassword') : t(lang, 'showPassword')}
      </button>
    </div>
  )
}

// Shown after successful registration
function CheckEmailScreen({ email, lang, onBack }) {
  const [resendAddr, setResendAddr] = useState(email)
  const [resendState, setResendState] = useState('idle') // 'idle' | 'loading' | 'sent'
  const [showResend, setShowResend] = useState(false)

  async function handleResend(e) {
    e.preventDefault()
    setResendState('loading')
    try {
      await resendVerification({ email: resendAddr })
      setResendState('sent')
    } catch {
      setResendState('idle')
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '.75rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem' }}>📧</div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)', margin: 0 }}>
          {t(lang, 'checkEmail')}
        </h2>
        <p style={{ fontSize: '.875rem', color: 'var(--muted)', margin: 0 }}>
          {t(lang, 'checkEmailDesc', email)}
        </p>

        {!showResend && resendState !== 'sent' && (
          <button type="button" className="btn-ghost" onClick={() => setShowResend(true)} style={{ fontSize: '.85rem' }}>
            {t(lang, 'resendVerification')}
          </button>
        )}

        {showResend && resendState !== 'sent' && (
          <form onSubmit={handleResend} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            <input
              type="email"
              placeholder={t(lang, 'emailPlaceholder')}
              value={resendAddr}
              onChange={e => setResendAddr(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary" disabled={resendState === 'loading'}>
              {resendState === 'loading' ? '…' : t(lang, 'resendVerification')}
            </button>
          </form>
        )}

        {resendState === 'sent' && (
          <p style={{ fontSize: '.875rem', color: 'var(--primary)' }}>{t(lang, 'resendSent')}</p>
        )}

        <button type="button" className="btn-ghost" onClick={onBack} style={{ fontSize: '.85rem', alignSelf: 'center' }}>
          {t(lang, 'backToLogin')}
        </button>
      </div>
    </div>
  )
}

function ForgotPasswordScreen({ lang, onBack }) {
  const [email, setEmail]   = useState('')
  const [state, setState]   = useState('idle') // 'idle' | 'loading' | 'sent'

  async function handleSubmit(e) {
    e.preventDefault()
    setState('loading')
    try {
      await forgotPassword({ email })
      setState('sent')
    } catch {
      setState('idle')
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)', margin: 0 }}>
          {t(lang, 'forgotPassword')}
        </h2>

        {state !== 'sent' ? (
          <>
            <p style={{ fontSize: '.875rem', color: 'var(--muted)', margin: 0 }}>
              {t(lang, 'forgotSubtitle')}
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              <input
                type="email"
                placeholder={t(lang, 'emailPlaceholder')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
                required
              />
              <button type="submit" className="btn-primary" disabled={state === 'loading'}>
                {state === 'loading' ? '…' : t(lang, 'sendResetLink')}
              </button>
            </form>
          </>
        ) : (
          <p style={{ fontSize: '.875rem', color: 'var(--primary)' }}>{t(lang, 'resetLinkSent')}</p>
        )}

        <button type="button" className="btn-ghost" onClick={onBack} style={{ alignSelf: 'center', fontSize: '.85rem' }}>
          {t(lang, 'backToLogin')}
        </button>
      </div>
    </div>
  )
}

export default function Login({ onLogin, lang, toggleLang, theme, toggleTheme }) {
  const [mode, setMode]   = useState('login')
  const [form, setForm]   = useState({ name: '', email: '', password: '', confirmPassword: '', rememberMe: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [registeredEmail, setRegisteredEmail] = useState(null)
  const [showForgot, setShowForgot] = useState(false)

  // Inline resend section shown when login is blocked by unverified email
  const [showInlineResend, setShowInlineResend] = useState(false)
  const [inlineResendEmail, setInlineResendEmail] = useState('')
  const [inlineResendState, setInlineResendState] = useState('idle')

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const errorMessages = {
    CONFLICT:            () => t(lang, 'authConflict'),
    INVALID_INPUT:       () => t(lang, 'authInvalid'),
    INVALID_CREDENTIALS: () => t(lang, 'invalidCredentials'),
    EMAIL_NOT_VERIFIED:  () => t(lang, 'emailNotVerified'),
    ACCOUNT_LOCKED:      () => t(lang, 'accountLocked') ?? 'Too many failed attempts. Try again in 15 minutes.',
    REGISTER_FAILED:     () => t(lang, 'registerFailed'),
  }

  function switchMode() {
    setMode(m => (m === 'login' ? 'register' : 'login'))
    setError(null)
    setShowForgot(false)
    setShowInlineResend(false)
    setInlineResendState('idle')
    setForm({ name: '', email: '', password: '', confirmPassword: '', rememberMe: false })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (mode === 'register' && form.password !== form.confirmPassword) {
      setError(t(lang, 'passwordMismatch'))
      return
    }
    setLoading(true)
    setError(null)
    setShowInlineResend(false)
    try {
      if (mode === 'register') {
        await register({ name: form.name, email: form.email, password: form.password })
        setRegisteredEmail(form.email)
      } else {
        const data = await login({ name: form.name, password: form.password, rememberMe: form.rememberMe })
        onLogin({ userId: data.userId, name: data.name })
      }
    } catch (err) {
      const msg = errorMessages[err.message]?.() ?? err.message
      setError(msg)
      if (err.message === 'EMAIL_NOT_VERIFIED') setShowInlineResend(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleInlineResend(e) {
    e.preventDefault()
    setInlineResendState('loading')
    try {
      await resendVerification({ email: inlineResendEmail })
      setInlineResendState('sent')
    } catch {
      setInlineResendState('idle')
    }
  }

  if (showForgot) {
    return (
      <ForgotPasswordScreen
        lang={lang}
        onBack={() => setShowForgot(false)}
      />
    )
  }

  if (registeredEmail) {
    return (
      <CheckEmailScreen
        email={registeredEmail}
        lang={lang}
        onBack={() => {
          setRegisteredEmail(null)
          setMode('login')
          setForm({ name: '', email: '', password: '', confirmPassword: '', rememberMe: false })
        }}
      />
    )
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <form className="card" onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--primary)' }}>Family Library</h1>
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <button type="button" className="btn-ghost" onClick={toggleTheme} style={{ fontSize: '.8rem', padding: '.3rem .7rem' }}>
              {theme === 'light' ? t(lang, 'darkMode') : t(lang, 'lightMode')}
            </button>
            <button type="button" className="btn-ghost" onClick={toggleLang} style={{ fontSize: '.8rem', padding: '.3rem .7rem' }}>
              {lang === 'tr' ? 'EN' : 'TR'}
            </button>
          </div>
        </div>

        <p style={{ fontSize: '.875rem', color: 'var(--muted)' }}>
          {mode === 'login' ? t(lang, 'signInSubtitle') : t(lang, 'registerSubtitle')}
        </p>

        {error && <p style={{ color: 'var(--accent)', fontSize: '.875rem' }}>{error}</p>}

        <input
          placeholder={t(lang, 'usernamePlaceholder')}
          value={form.name}
          onChange={e => set('name', e.target.value)}
          autoFocus
          required
        />

        {mode === 'register' && (
          <input
            type="email"
            placeholder={t(lang, 'emailPlaceholder')}
            value={form.email}
            onChange={e => set('email', e.target.value)}
            required
          />
        )}

        <PasswordInput
          placeholder={t(lang, 'passwordPlaceholder')}
          value={form.password}
          onChange={e => set('password', e.target.value)}
          lang={lang}
        />

        {mode === 'register' && (
          <PasswordInput
            placeholder={t(lang, 'confirmPasswordPlaceholder')}
            value={form.confirmPassword}
            onChange={e => set('confirmPassword', e.target.value)}
            lang={lang}
          />
        )}

        {mode === 'login' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.875rem', color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.rememberMe} onChange={e => set('rememberMe', e.target.checked)} style={{ width: 'auto' }} />
              {t(lang, 'rememberMe')}
            </label>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowForgot(true)}
              style={{ fontSize: '.8rem', padding: '.2rem .4rem' }}
            >
              {t(lang, 'forgotPassword')}
            </button>
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? '…' : mode === 'login' ? t(lang, 'signIn') : t(lang, 'createAccount')}
        </button>

        {showInlineResend && inlineResendState !== 'sent' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', borderTop: '1px solid var(--border)', paddingTop: '.5rem' }}>
            <input
              type="email"
              placeholder={t(lang, 'emailPlaceholder')}
              value={inlineResendEmail}
              onChange={e => setInlineResendEmail(e.target.value)}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={handleInlineResend}
              disabled={inlineResendState === 'loading' || !inlineResendEmail}
              style={{ fontSize: '.85rem' }}
            >
              {inlineResendState === 'loading' ? '…' : t(lang, 'resendVerification')}
            </button>
          </div>
        )}

        {inlineResendState === 'sent' && (
          <p style={{ fontSize: '.875rem', color: 'var(--primary)', textAlign: 'center' }}>
            {t(lang, 'resendSent')}
          </p>
        )}

        <button type="button" className="btn-ghost" onClick={switchMode} style={{ alignSelf: 'center', fontSize: '.85rem' }}>
          {mode === 'login' ? t(lang, 'noAccount') : t(lang, 'haveAccount')}
        </button>
      </form>
    </div>
  )
}
