import { Star } from 'lucide-react'

export default function RatingPicker({ label, value, onChange, t }) {
  return (
    <div className="rating-field">
      <span className="rating-label">{label}</span>

      <div className="star-picker" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={value === rating}
            aria-label={`${rating} ${rating === 1 ? t.detail.star : t.detail.stars}`}
            className={rating <= value ? 'selected' : ''}
            onClick={() => onChange(rating)}
          >
            <Star size={24} strokeWidth={1.8} fill={rating <= value ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}
