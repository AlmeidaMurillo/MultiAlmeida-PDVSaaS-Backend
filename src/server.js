import 'dotenv/config';
import app from './app.js';
import setupDatabase from './database/setup.js';
import pool from './db.js';

const port = process.env.PORT || 5000;

const cleanupExpiredSessions = async () => {
  console.log('Executando limpeza de sessões expiradas...');
  try {
    const [result] = await pool.execute(
      `UPDATE sessoes_usuarios SET esta_ativo = FALSE WHERE expira_em < NOW()`
    );
    if (result.affectedRows > 0) {
      console.log(`${result.affectedRows} sessões expiradas foram desativadas.`);
    }
  } catch (error) {
    console.error('Erro ao limpar sessões expiradas:', error);
  }
};

const startServer = async () => {
  try {
    await setupDatabase();
    
    
    app.listen(port, () => {
      console.log(`🚀 Servidor rodando na porta ${port}`);
      
      setInterval(cleanupExpiredSessions, 5 * 60 * 1000);
      
      cleanupExpiredSessions();
    });
  } catch (error) {
    console.error("❌ Falha ao iniciar o servidor. Verifique a conexão com o banco de dados.");
    process.exit(1); 
  }
};

startServer();
