import 'dotenv/config';
import app from './app.js';
import pool from './db.js';
import bcrypt from 'bcryptjs';

const port = process.env.PORT || 5000;

// Função para criar um admin padrão se não existir
async function createDefaultAdmin() {
  const adminEmail = 'admin@gmail.com';
  const adminPassword = 'admin123';

  try {
    const [rows] = await pool.execute('SELECT * FROM admins WHERE email = ?', [adminEmail]);

    if (rows.length === 0) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await pool.execute('INSERT INTO admins (nome, email, senha) VALUES (?, ?, ?)', ['Admin Padrão', adminEmail, hashedPassword]);
      console.log(`✅ Admin padrão criado com o email: ${adminEmail}`);
    } else {
      console.log('ℹ️ Admin padrão já existe.');
    }
  } catch (error) {
    console.error('❌ Erro ao criar admin padrão:', error);
  }
}

app.listen(port, async () => {
  await createDefaultAdmin();
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
