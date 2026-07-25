import { useEffect, useState } from 'react'
import {
  getHousehold, createHousehold, generateInvite,
  joinHousehold, leaveHousehold, disbandHousehold, removeMember,
} from '../api/household'
import { t } from '../i18n'

export default function Household({ lang, onAuthError, userId }) {
  const [loading, setLoading]     = useState(true)
  const [household, setHousehold] = useState(null) // null = not in one
  const [error, setError]         = useState(null)

  // Create form
  const [createName, setCreateName]       = useState('')
  const [createLoading, setCreateLoading] = useState(false)

  // Join form
  const [joinCode, setJoinCode]       = useState('')
  const [joinLoading, setJoinLoading] = useState(false)

  // Invite code
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeCopied, setCodeCopied]   = useState(false)

  // Confirm actions
  const [confirmAction, setConfirmAction] = useState(null) // { type, label, fn }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await getHousehold()
      setHousehold(data)
    } catch (e) {
      if (e.status === 401) { onAuthError?.(); return }
      if (e.status === 404) setHousehold(null)
      else setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreateLoading(true)
    setError(null)
    try {
      const data = await createHousehold(createName)
      setHousehold(data)
      setCreateName('')
    } catch (e) {
      if (e.status === 401) { onAuthError?.(); return }
      setError(e.message)
    } finally {
      setCreateLoading(false)
    }
  }

  async function handleJoin(e) {
    e.preventDefault()
    setJoinLoading(true)
    setError(null)
    try {
      const data = await joinHousehold(joinCode)
      setHousehold(data)
      setJoinCode('')
    } catch (e) {
      if (e.status === 401) { onAuthError?.(); return }
      setError(e.message)
    } finally {
      setJoinLoading(false)
    }
  }

  async function handleGenerateCode() {
    setCodeLoading(true)
    try {
      const data = await generateInvite()
      setHousehold(prev => ({ ...prev, inviteCode: data.inviteCode, inviteCodeExpiry: data.expiresAt }))
    } catch (e) {
      if (e.status === 401) { onAuthError?.(); return }
      setError(e.message)
    } finally {
      setCodeLoading(false)
    }
  }

  async function handleCopyCode() {
    if (!household?.inviteCode) return
    await navigator.clipboard.writeText(household.inviteCode)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  async function handleConfirmed() {
    if (!confirmAction) return
    const fn = confirmAction.fn
    setConfirmAction(null)
    setError(null)
    try {
      await fn()
      setHousehold(null)
    } catch (e) {
      if (e.status === 401) { onAuthError?.(); return }
      setError(e.message)
    }
  }

  async function handleRemoveMember(memberId, memberName) {
    setError(null)
    try {
      await removeMember(memberId)
      setHousehold(prev => ({ ...prev, members: prev.members.filter(m => m.id !== memberId) }))
    } catch (e) {
      if (e.status === 401) { onAuthError?.(); return }
      setError(e.message)
    }
  }

  const isOwner = household?.ownerId === userId

  if (loading) return (
    <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>{t(lang, 'loading')}</p>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {error && (
        <p style={{ color: 'var(--accent)', fontSize: '.875rem', padding: '.5rem 0' }}>{error}</p>
      )}

      {/* ── Confirm overlay ─────────────────────────────────────────── */}
      {confirmAction && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', border: '1.5px solid var(--accent)' }}>
          <p style={{ fontSize: '.9rem' }}>{confirmAction.label}</p>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button className="btn-danger" onClick={handleConfirmed} style={{ flex: 1 }}>
              {t(lang, 'confirm')}
            </button>
            <button className="btn-ghost" onClick={() => setConfirmAction(null)} style={{ flex: 1 }}>
              {t(lang, 'cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ── Not in a household ─────────────────────────────────────── */}
      {!household && !confirmAction && (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>
              {t(lang, 'createHousehold')}
            </h2>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              <input
                placeholder={t(lang, 'householdNamePlaceholder')}
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                required
                autoFocus
              />
              <button type="submit" className="btn-primary" disabled={createLoading}>
                {createLoading ? '…' : t(lang, 'createHousehold')}
              </button>
            </form>
          </div>

          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.85rem' }}>
            {t(lang, 'or')}
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>
              {t(lang, 'joinHousehold')}
            </h2>
            <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              <input
                placeholder={t(lang, 'inviteCodePlaceholder')}
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                maxLength={8}
                required
                style={{ letterSpacing: '.15em', fontFamily: 'monospace', fontSize: '1.1rem' }}
              />
              <button type="submit" className="btn-primary" disabled={joinLoading}>
                {joinLoading ? '…' : t(lang, 'joinHousehold')}
              </button>
            </form>
          </div>
        </>
      )}

      {/* ── In a household ─────────────────────────────────────────── */}
      {household && !confirmAction && (
        <>
          {/* Header */}
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)' }}>
                {household.name}
              </h2>
              <p style={{ fontSize: '.8rem', color: 'var(--muted)', marginTop: '.15rem' }}>
                {t(lang, 'memberCount', household.members?.length ?? 1)}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              {isOwner ? (
                <button
                  className="btn-danger"
                  onClick={() => setConfirmAction({ label: t(lang, 'confirmDisband'), fn: disbandHousehold })}
                  style={{ fontSize: '.8rem', padding: '.35rem .7rem' }}
                >
                  {t(lang, 'disbandHousehold')}
                </button>
              ) : (
                <button
                  className="btn-ghost"
                  onClick={() => setConfirmAction({ label: t(lang, 'confirmLeave'), fn: leaveHousehold })}
                  style={{ fontSize: '.8rem', padding: '.35rem .7rem' }}
                >
                  {t(lang, 'leaveHousehold')}
                </button>
              )}
            </div>
          </div>

          {/* Members */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            <h3 style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {t(lang, 'members')}
            </h3>
            {household.members?.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: '.95rem' }}>{m.name}</span>
                  {m.isOwner && (
                    <span style={{ marginLeft: '.5rem', fontSize: '.72rem', color: 'var(--muted)', background: 'var(--border)', padding: '.1rem .4rem', borderRadius: '99px' }}>
                      {t(lang, 'owner')}
                    </span>
                  )}
                  {m.email && (
                    <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.1rem' }}>{m.email}</p>
                  )}
                </div>
                {isOwner && !m.isOwner && (
                  <button
                    className="btn-ghost"
                    onClick={() => handleRemoveMember(m.id, m.name)}
                    style={{ fontSize: '.78rem', padding: '.25rem .5rem', color: 'var(--accent)' }}
                  >
                    {t(lang, 'removeMember')}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Invite code — owner only */}
          {isOwner && <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            <h3 style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {t(lang, 'inviteCode')}
            </h3>

            {household.inviteCode && household.inviteCodeExpiry && new Date(household.inviteCodeExpiry) > new Date() ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                  <span style={{
                    fontFamily: 'monospace', fontSize: '1.6rem', fontWeight: 700,
                    letterSpacing: '.2em', color: 'var(--primary)',
                    background: 'var(--bg)', padding: '.4rem .8rem', borderRadius: '8px',
                    border: '1.5px dashed var(--border)',
                  }}>
                    {household.inviteCode}
                  </span>
                  <button className="btn-secondary" onClick={handleCopyCode} style={{ fontSize: '.82rem' }}>
                    {codeCopied ? t(lang, 'codeCopied') : t(lang, 'copyCode')}
                  </button>
                </div>
                <p style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
                  {t(lang, 'codeExpiry', new Date(household.inviteCodeExpiry).toLocaleString())}
                </p>
              </>
            ) : (
              <p style={{ fontSize: '.875rem', color: 'var(--muted)' }}>{t(lang, 'noActiveCode')}</p>
            )}

            <button className="btn-secondary" onClick={handleGenerateCode} disabled={codeLoading} style={{ alignSelf: 'flex-start', fontSize: '.85rem' }}>
              {codeLoading ? '…' : household.inviteCode ? t(lang, 'refreshCode') : t(lang, 'generateCode')}
            </button>
          </div>}
        </>
      )}
    </div>
  )
}
