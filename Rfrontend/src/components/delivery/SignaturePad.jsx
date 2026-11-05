import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

export default function SignaturePad({ t, onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)
  const [signed, setSigned] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * ratio))
    canvas.height = Math.max(1, Math.round(rect.height * ratio))
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.4
    ctx.strokeStyle = '#0e3b3a'
  }, [])

  function point(event) {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function start(event) {
    event.preventDefault()
    canvasRef.current.setPointerCapture(event.pointerId)
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = point(event)
    drawing.current = true
    hasInk.current = true
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 0.01, y + 0.01)
    ctx.stroke()
  }

  function move(event) {
    if (!drawing.current) return
    event.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = point(event)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    setSigned(true)
    onChange(canvasRef.current.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    hasInk.current = false
    setSigned(false)
    onChange(null)
  }

  return (
    <div className="signature-box">
      <h3>{t.signature.title}</h3>
      <canvas
        ref={canvasRef}
        className={`signature-canvas${signed ? ' signed' : ''}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        aria-label={t.signature.title}
      />
      <div className="signature-foot">
        <p className="signature-help">{t.signature.help}</p>
        <button className="button outline small" type="button" onClick={clear} disabled={!signed}>
          <Eraser size={13} strokeWidth={2.2} aria-hidden="true" /> {t.signature.clear}
        </button>
      </div>
    </div>
  )
}
