import { useRef, useState } from 'react'
import { ImagePlus, Trash2, Upload } from 'lucide-react'

export default function ProductImageForm({ product, onUpload, onRemove, t }) {
  const inputId = `product-image-${product.id}`
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileError, setFileError] = useState('')
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  const fileSize = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`

  async function submit(event) {
    event.preventDefault()
    if (!inputRef.current?.files?.[0]) return

    setUploading(true)
    try {
      if (await onUpload(event.currentTarget, product)) {
        event.currentTarget.reset()
        setSelectedFile(null)
        setFileError('')
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <form className="product-image-form" onSubmit={submit}>
      <span className="file-label" id={`${inputId}-label`}>{t.products.imageLabel}</span>

      <input
        ref={inputRef}
        id={inputId}
        className="visually-hidden"
        name="image"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        required
        aria-labelledby={`${inputId}-label`}
        aria-describedby={`${inputId}-hint`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] || null
          setSelectedFile(file)
          setFileError(
            file && (!file.size || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) ? t.products.imageInvalid
              : file && file.size > 5 * 1024 * 1024 ? t.products.imageTooLarge
                : '',
          )
        }}
      />

      <label className="file-picker" htmlFor={inputId}>
        <span className="file-picker-icon" aria-hidden="true"><ImagePlus size={18} strokeWidth={2} /></span>
        <span className="file-picker-text">
          <strong>{selectedFile ? selectedFile.name : t.products.chooseImage}</strong>
          <small id={`${inputId}-hint`}>
            {selectedFile ? `${fileSize(selectedFile.size)} · ${t.products.imageReady}` : t.products.imageHint}
          </small>
        </span>
      </label>

      {fileError && <p className="file-error" role="alert">{fileError}</p>}

      <div className="image-actions">
        <button className="button primary small" type="submit" disabled={!selectedFile || Boolean(fileError) || uploading}>
          <Upload size={14} aria-hidden="true" />
          {uploading ? t.products.uploadingImage : t.products.uploadImage}
        </button>
        {product.hasImage && (
          <button className="button danger small" type="button" onClick={() => onRemove(product)} disabled={uploading}>
            <Trash2 size={14} aria-hidden="true" />
            {t.products.removeImage}
          </button>
        )}
      </div>
    </form>
  )
}
