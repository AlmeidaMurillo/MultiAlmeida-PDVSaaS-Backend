import 'dotenv/config';
import app from './app.js';
import pool from './db.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const port = process.env.PORT || 5000;

// Função para criar um admin padrão se não existir
async function createDefaultAdmin() {
  const adminEmail = 'admin@gmail.com';
  const adminPassword = 'admin123';

  try {
    const [rows] = await pool.execute('SELECT * FROM usuarios WHERE email = ?', [adminEmail]);

    if (rows.length === 0) {
      const adminId = uuidv4();
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await pool.execute('INSERT INTO usuarios (id, nome, email, senha, papel) VALUES (?, ?, ?, ?, ?)', [adminId, 'Admin Padrão', adminEmail, hashedPassword, 'admin']);
    } else {
    }
  } catch (error) {
    console.error('❌ Erro ao criar admin padrão:', error);
  }
}

app.listen(port, async () => {
  await createDefaultAdmin();
  console.log(`🚀 Servidor rodando na porta ${port}`);
});