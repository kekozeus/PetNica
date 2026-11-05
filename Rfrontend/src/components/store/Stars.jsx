import { Star } from 'lucide-react'

export default function Stars({ rating = 0, label }) {
  const filled = Math.round(Math.max(0, Math.min(5, Number(rating) || 0)))

  return (
    <span className="stars" role="img" aria-label={label || `${Number(rating).toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={16}
          strokeWidth={1.8}
          className={star <= filled ? 'filled' : ''}
          fill={star <= filled ? 'currentColor' : 'none'}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}
