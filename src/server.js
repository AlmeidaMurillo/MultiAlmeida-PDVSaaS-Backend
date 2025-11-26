import 'dotenv/config';
import app from './app.js';
import setupDatabase from './database/setup.js';

const port = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await setupDatabase();
    
    // Inicia o servidor
    app.listen(port, () => {
      console.log(`🚀 Servidor rodando na porta ${port}`);
    });
  } catch (error) {
    console.error("❌ Falha ao iniciar o servidor. Verifique a conexão com o banco de dados.");
    process.exit(1); 
  }
};

startServer();
