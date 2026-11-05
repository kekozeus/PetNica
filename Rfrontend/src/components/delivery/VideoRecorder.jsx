import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleStop, Upload, Video } from 'lucide-react'

const MAX_SECONDS = 90
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
]

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return `${m}:${s}`
}

export default function VideoRecorder({ t, orderId, request, onUploaded }) {
  const [phase, setPhase] = useState('idle') // idle | recording | preview | uploading | done
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const blobRef = useRef(null)
  const timerRef = useRef(null)
  const liveRef = useRef(null)
  const fileInputRef = useRef(null)

  const canRecord = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'

  const stopStream = useCallback(() => {
    clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => {
    stopStream()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [stopStream, previewUrl])

  async function start() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      streamRef.current = stream
      if (liveRef.current) {
        liveRef.current.srcObject = stream
        await liveRef.current.play().catch(() => {})
      }
      const recorder = new MediaRecorder(stream, pickMime() ? { mimeType: pickMime() } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        blobRef.current = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' })
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewUrl(URL.createObjectURL(blobRef.current))
        setPhase('preview')
        stopStream()
      }
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed((value) => {
          if (value + 1 >= MAX_SECONDS) stop()
          return value + 1
        })
      }, 1000)
      recorder.start(500)
      setPhase('recording')
    } catch {
      stopStream()
      setPhase('idle')
      setError(t.video.permissionError)
    }
  }

  function stop() {
    clearInterval(timerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    else stopStream()
  }

  function retake() {
    blobRef.current = null
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setPhase('idle')
    setError('')
    setProgress(0)
  }

  async function uploadBlob(blob) {
    setPhase('uploading')
    setProgress(0)
    setError('')
    try {
      const contentType = blob.type || 'video/webm'
      const ticket = await request(`/api/delivery/orders/${orderId}/video-url`, {
        method: 'POST',
        body: { contentType },
      })
      if (ticket.mode === 'local') {
        const data = new FormData()
        data.append('video', blob, `entrega.${contentType.split('/')[1]?.split(';')[0] || 'webm'}`)
        const result = await request(`/api/delivery/orders/${orderId}/video`, { method: 'POST', body: data })
        onUploaded({ path: result.path, url: result.url })
      } else {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', ticket.uploadUrl)
          xhr.setRequestHeader('Content-Type', contentType)
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100))
          }
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('upload')))
          xhr.onerror = () => reject(new Error('upload'))
          xhr.send(blob)
        })
        setProgress(100)
        onUploaded({ path: ticket.path, url: ticket.videoUrl })
      }
      setPhase('done')
    } catch (err) {
      setPhase(blobRef.current ? 'preview' : 'idle')
      setError(err.status === 401 ? err.message : t.video.uploadError)
    }
  }

  function useRecording() {
    if (blobRef.current) uploadBlob(blobRef.current)
  }

  function pickFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    blobRef.current = file
    uploadBlob(file)
    event.target.value = ''
  }

  return (
    <div className="video-box">
      <h3>{t.video.title}</h3>

      <div className="video-frame" hidden={phase === 'done'}>
        {phase === 'preview' && previewUrl ? (
          <video src={previewUrl} controls playsInline />
        ) : (
          <video ref={liveRef} muted playsInline autoPlay />
        )}
        {phase === 'recording' && <span className="rec-dot">{t.video.recording.replace('{time}', formatTime(elapsed))}</span>}
      </div>

      {phase === 'done' && (
        <span className="video-ready"><CheckCircle2 size={16} strokeWidth={2.2} aria-hidden="true" /> {t.video.ready}</span>
      )}

      {phase === 'uploading' && (
        <>
          <div className="upload-bar" role="progressbar" aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100">
            <span style={{ width: `${Math.max(progress, 4)}%` }} />
          </div>
          <p className="video-help">{t.video.uploading.replace('{progress}', progress)}</p>
        </>
      )}

      <div className="video-actions">
        {phase === 'idle' && canRecord && (
          <button className="button outline" type="button" onClick={start}>
            <Video size={15} strokeWidth={2} aria-hidden="true" /> {t.video.start}
          </button>
        )}
        {phase === 'recording' && (
          <button className="button danger" type="button" onClick={stop}>
            <CircleStop size={15} strokeWidth={2} aria-hidden="true" /> {t.video.stop}
          </button>
        )}
        {phase === 'preview' && (
          <>
            <button className="button primary" type="button" onClick={useRecording}>
              <Upload size={15} strokeWidth={2} aria-hidden="true" /> {t.video.use}
            </button>
            <button className="button outline" type="button" onClick={retake}>{t.video.retake}</button>
          </>
        )}
        {(phase === 'idle' || !canRecord) && (
          <label className="button outline" style={{ cursor: 'pointer' }}>
            <Upload size={15} strokeWidth={2} aria-hidden="true" /> {t.video.uploadFile}
            <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={pickFile} />
          </label>
        )}
        {phase === 'done' && (
          <button className="button outline small" type="button" onClick={retake}>{t.video.retake}</button>
        )}
      </div>

      {!canRecord && <p className="video-help">{t.video.unsupported}</p>}
      {canRecord && phase === 'idle' && <p className="video-help">{t.video.permission} {t.video.maxNote}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
    </div>
  )
}
