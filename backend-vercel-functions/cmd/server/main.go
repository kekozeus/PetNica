// Servidor de desarrollo local — equivalente a `node server.js` del backend
// original: sirve /api/*, /images/* desde disco y el cliente estático de public/.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"petnica/app"
)

func main() {
	loadDotEnv(".env")

	application, err := app.NewApp(context.Background())
	if err != nil {
		log.Fatalf("No se pudo iniciar PetNica: %v", err)
	}
	defer application.Close()

	static := http.FileServer(http.Dir("public"))
	mux := http.NewServeMux()
	mux.Handle("/api/", application)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Sirve archivos estáticos de public/ y, para rutas sin archivo
		// (SPA), devuelve index.html igual que la versión Node.
		path := filepath.Join("public", filepath.Clean(strings.TrimPrefix(r.URL.Path, "/")))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			static.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodGet {
			http.ServeFile(w, r, filepath.Join("public", "index.html"))
			return
		}
		http.NotFound(w, r)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	server := &http.Server{Addr: ":" + port, Handler: mux}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		_ = server.Close()
	}()

	log.Printf("PetNica (Go) disponible en http://localhost:%s", port)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// loadDotEnv aplica un archivo .env sencillo (KEY=valor) sin dependencias.
func loadDotEnv(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
}
