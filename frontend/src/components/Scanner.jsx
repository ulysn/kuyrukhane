import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { importBook } from '../api/books'
import { t } from '../i18n'

export default function Scanner({ onImported, onAuthError, lang }) {
  const videoRef   = useRef(null)
  const streamRef  = useRef(null)
  const timerRef   = useRef(null)
  const loadingRef = useRef(false)

  const [active, setActive]   = useState(false)
  const [status, setStatus]   = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!active) return
    startScanner()
    return stopScanner
  }, [active])

  async function startScanner() {
    if (!window.isSecureContext) {
      setStatus(t(lang, 'httpsRequired'))
      setActive(false)
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
    } catch (e) {
      setStatus(e.name === 'NotAllowedError' ? t(lang, 'permDenied') : (e.message || t(lang, 'cameraFail')))
      setActive(false)
      return
    }

    streamRef.current = stream
    const video = videoRef.current
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play()

    let nativeDetector = null
    if ('BarcodeDetector' in window) {
      try {
        nativeDetector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        })
      } catch (_) {}
    }

    if (nativeDetector) {
      const detector = nativeDetector
      async function tick() {
        if (!loadingRef.current && videoRef.current?.readyState === 4) {
          try {
            const barcodes = await detector.detect(videoRef.current)
            if (barcodes.length > 0) {
              await handleIsbn(barcodes[0].rawValue)
              return
            }
          } catch (_) {}
        }
        timerRef.current = setTimeout(tick, 250)
      }
      timerRef.current = setTimeout(tick, 250)
    } else {
      const reader = new BrowserMultiFormatReader()
      try {
        await reader.decodeFromStream(streamRef.current, videoRef.current, async (result, _err) => {
          if (!result || loadingRef.current) return
          await handleIsbn(result.getText())
        })
      } catch (e) {
        setStatus(e.message || t(lang, 'noSupport'))
        stopScanner()
      }
    }
  }

  async function handleIsbn(isbn) {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setStatus(t(lang, 'found', isbn))
    try {
      const book = await importBook(isbn)
      setStatus(t(lang, 'imported', book.baslik))
      onImported()
      stopScanner()
    } catch (e) {
      if (e.status === 401) { onAuthError?.(); return }
      setStatus(e.message)
      loadingRef.current = false
      setLoading(false)
    }
  }

  function stopScanner() {
    clearTimeout(timerRef.current)
    timerRef.current = null
    BrowserMultiFormatReader.releaseAllStreams()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    loadingRef.current = false
    setLoading(false)
    setActive(false)
  }

  const importedKey = t(lang, 'imported', '')
  const isSuccess = status?.startsWith(importedKey.slice(0, 4))

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>{t(lang, 'scanTitle')}</h2>

      {active && (
        <div style={{ position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden', background: '#000' }}>
          <video ref={videoRef} style={{ width: '100%', maxHeight: '280px', objectFit: 'cover', display: 'block' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ width: '75%', height: '35%', border: '2px solid rgba(255,255,255,.85)', borderRadius: '8px', boxShadow: '0 0 0 9999px rgba(0,0,0,.45)' }} />
          </div>
        </div>
      )}

      {status && (
        <p style={{ fontSize: '.875rem', color: isSuccess ? '#065f46' : 'var(--accent)' }}>
          {status}
        </p>
      )}

      {!active && !isSuccess && (
        <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{t(lang, 'scanHint')}</p>
      )}

      {status?.includes('HTTPS') && (
        <p style={{ fontSize: '.8rem', color: 'var(--muted)', background: 'var(--bg)', padding: '.75rem', borderRadius: '8px' }}>
          Run the backend with <code>dotnet run --launch-profile https</code> and open{' '}
          <code>https://&lt;your-pc-ip&gt;:7222</code> on your phone.
        </p>
      )}

      <div style={{ display: 'flex', gap: '.5rem' }}>
        {!active
          ? <button className="btn-primary"   onClick={() => { setStatus(null); setActive(true) }}>{t(lang, 'startCamera')}</button>
          : <button className="btn-secondary" onClick={stopScanner} disabled={loading}>{t(lang, 'stop')}</button>
        }
      </div>
    </div>
  )
}
