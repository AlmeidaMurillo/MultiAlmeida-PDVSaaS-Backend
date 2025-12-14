import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();


const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST,
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME,
  
  timezone: '-03:00',
  
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Configura o timezone em cada conexão do pool
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '-03:00';", (error) => {
    if (error) {
      console.error('Erro ao configurar timezone:', error);
    }
  });
});

export default pool;