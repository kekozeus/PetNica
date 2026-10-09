require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

function askHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Ejecuta este comando en una terminal interactiva para ocultar la contraseña.'));
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (character) => {
      if (character === '\u0003') {
        finish(new Error('Configuración cancelada.'));
      } else if (character === '\r' || character === '\n') {
        finish();
      } else if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
      } else if (character >= ' ' && character !== '\u007f') {
        value += character;
      }
    };
    stdin.on('data', onData);
    stdin.once('error', finish);
  });
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  let client;
  let transactionStarted = false;
  const terminal = readline.createInterface({ input: stdin, output: stdout });

  try {
    if (!process.env.DATABASE_URL) throw new Error('Configura DATABASE_URL en .env antes de crear la cuenta.');
    const schema = await fs.readFile(path.join(__dirname, '..', 'data', 'admin-schema.sql'), 'utf8');
    await pool.query(schema);
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('SELECT pg_advisory_xact_lock(7312026)');
    const existing = await client.query('SELECT count(*)::int AS count FROM admin_users');
    if (existing.rows[0].count > 0) {
      throw new Error('Ya existe una cuenta administradora. No se creó otra.');
    }

    const email = (await terminal.question('Correo del administrador: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) {
      throw new Error('Escribe un correo válido de máximo 150 caracteres.');
    }
    terminal.close();

    const password = await askHidden('Contraseña (mínimo 12 caracteres, no se mostrará): ');
    const confirmation = await askHidden('Confirma la contraseña: ');
    if (password.length < 12 || password.length > 200) {
      throw new Error('La contraseña debe tener entre 12 y 200 caracteres.');
    }
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      'INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)',
      [email, passwordHash],
    );
    await client.query('COMMIT');
    transactionStarted = false;
    console.log(`Cuenta administradora creada para ${email}. Ya puedes iniciar sesión en http://localhost:${process.env.PORT || 3000}/admin`);
  } catch (error) {
    if (transactionStarted && client) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('No se pudo revertir la creación del administrador:', rollbackError);
      });
    }
    throw error;
  } finally {
    terminal.close();
    if (client) client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
