CREATE TABLE IF NOT EXISTS admin_users (
    admin_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email          VARCHAR(150) NOT NULL,
    password_hash  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_lower
    ON admin_users (lower(email));
