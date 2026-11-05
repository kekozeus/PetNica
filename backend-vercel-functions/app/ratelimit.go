package app

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// rateLimiter replica express-rate-limit con ventana fija. En serverless el
// conteo vive por instancia caliente, igual que un límite en memoria.
type rateLimiter struct {
	mu     sync.Mutex
	window time.Duration
	limit  int
	hits   map[string]*rateEntry
	trust  bool
}

type rateEntry struct {
	count int
	reset time.Time
}

func newRateLimiter(trustProxy bool, limit int) *rateLimiter {
	return &rateLimiter{
		window: 15 * time.Minute,
		limit:  limit,
		hits:   make(map[string]*rateEntry),
		trust:  trustProxy,
	}
}

func (rl *rateLimiter) clientKey(r *http.Request) string {
	if rl.trust {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			return strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// middleware envuelve un handler con el límite configurado por ventana de 15 min.
func (rl *rateLimiter) middleware(next handler) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		key := rl.clientKey(r)
		now := time.Now()

		rl.mu.Lock()
		entry := rl.hits[key]
		if entry == nil || now.After(entry.reset) {
			entry = &rateEntry{reset: now.Add(rl.window)}
			rl.hits[key] = entry
		}
		entry.count++
		count, reset := entry.count, entry.reset
		if len(rl.hits) > 10000 { // limpieza oportunista
			for k, e := range rl.hits {
				if now.After(e.reset) {
					delete(rl.hits, k)
				}
			}
		}
		rl.mu.Unlock()

		w.Header().Set("RateLimit-Limit", strconv.Itoa(rl.limit))
		w.Header().Set("RateLimit-Policy", strconv.Itoa(rl.limit)+";w=900")
		if count > rl.limit {
			retry := int(time.Until(reset).Seconds()) + 1
			w.Header().Set("RateLimit-Reset", "900")
			w.Header().Set("Retry-After", strconv.Itoa(retry))
			writeJSON(w, http.StatusTooManyRequests, map[string]any{
				"error": "Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.",
			})
			return nil
		}
		return next(w, r)
	}
}
