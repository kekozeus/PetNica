package handler

import (
	"net/http"
	"strings"
	"sync"

	"petnica/app"
)

var (
	appOnce sync.Once
	appInst *app.App
	appErr  error
)

// Handler es la función serverless de Vercel. Recibe /api/* gracias al
// rewrite definido en vercel.json (__originalPath conserva la ruta real).
func Handler(w http.ResponseWriter, r *http.Request) {
	appOnce.Do(func() {
		appInst, appErr = app.NewApp(r.Context())
	})
	if appErr != nil {
		http.Error(w, `{"error":"El backend no está disponible por un problema de configuración o base de datos."}`,
			http.StatusServiceUnavailable)
		return
	}

	if original := r.URL.Query().Get("__originalPath"); original != "" {
		q := r.URL.Query()
		q.Del("__originalPath")
		if !strings.HasPrefix(original, "/") {
			original = "/" + original
		}
		r.URL.Path = "/api" + original
		r.URL.RawQuery = q.Encode()
	}

	appInst.ServeHTTP(w, r)
}
