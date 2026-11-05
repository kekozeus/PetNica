import Stars from './Stars.jsx'

export default function ReviewList({ items, empty, t, locale }) {
  if (!items?.length) return <p className="reviews-empty">{empty}</p>

  return (
    <div className="review-list">
      {items.map((review, index) => (
        <article className="review-card" key={`${review.createdAt}-${index}`}>
          <div className="review-card-head">
            <div>
              <Stars rating={review.rating} label={`${Number(review.rating).toFixed(1)} ${t.detail.rating}`} />
              <b>{review.customerName}</b>
            </div>
            <time>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(review.createdAt))}</time>
          </div>

          <p>{review.comment || t.detail.noComment}</p>
        </article>
      ))}
    </div>
  )
}
