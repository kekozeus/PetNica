// Crea la cuenta administradora inicial — equivalente de
// scripts/create-admin.js del backend Node.
package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"regexp"
	"strings"
	"syscall"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/term"
)

const adminSchema = `
CREATE TABLE IF NOT EXISTS admin_users (
    admin_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR(150) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`

const adminEmailIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_lower
ON admin_users (lower(email))`

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func main() {
	loadDotEnv(".env")
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("configura DATABASE_URL en .env antes de crear la cuenta")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	if _, err := conn.Exec(ctx, adminSchema); err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, adminEmailIndex); err != nil {
		return err
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7312026)`); err != nil {
		return err
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM admin_users`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("ya existe una cuenta administradora. No se creó otra")
	}

	reader := bufio.NewReader(os.Stdin)
	fmt.Print("Correo del administrador: ")
	email, _ := reader.ReadString('\n')
	email = strings.ToLower(strings.TrimSpace(email))
	if !emailPattern.MatchString(email) || len(email) > 150 {
		return fmt.Errorf("escribe un correo válido de máximo 150 caracteres")
	}

	password, err := askHidden("Contraseña (mínimo 12 caracteres, no se mostrará): ")
	if err != nil {
		return err
	}
	confirmation, err := askHidden("Confirma la contraseña: ")
	if err != nil {
		return err
	}
	if len(password) < 12 || len(password) > 200 {
		return fmt.Errorf("la contraseña debe tener entre 12 y 200 caracteres")
	}
	if password != confirmation {
		return fmt.Errorf("las contraseñas no coinciden")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)`,
		email, string(hash)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	fmt.Printf("Cuenta administradora creada para %s. Ya puedes iniciar sesión en http://localhost:%s/admin\n", email, port)
	return nil
}

func askHidden(prompt string) (string, error) {
	if !term.IsTerminal(int(syscall.Stdin)) {
		return "", fmt.Errorf("ejecuta este comando en una terminal interactiva para ocultar la contraseña")
	}
	fmt.Print(prompt)
	bytes, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println()
	return string(bytes), err
}

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
