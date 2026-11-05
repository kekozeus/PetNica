package app

import (
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"
)

type apiError struct {
	status int
	msg    string
}

func (e *apiError) Error() string { return e.msg }

func errf(status int, format string, args ...any) *apiError {
	return &apiError{status: status, msg: fmt.Sprintf(format, args...)}
}

// handler es la firma común de todos los endpoints del API.
type handler func(http.ResponseWriter, *http.Request) error

func handle(fn handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			writeError(w, err)
		}
	}
}

// writeError replica el middleware de errores de Express del backend Node.
func writeError(w http.ResponseWriter, err error) {
	var ae *apiError
	if errors.As(err, &ae) {
		writeJSON(w, ae.status, map[string]any{"error": ae.msg})
		return
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			writeJSON(w, http.StatusConflict, map[string]any{"error": "Ya existe un producto, SKU o administrador con esos datos."})
			return
		case "23503", "23514":
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Uno de los datos seleccionados no es válido."})
			return
		}
	}
	log.Printf("Error al procesar la solicitud: %v", err)
	writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Ocurrió un error al procesar la solicitud."})
}
