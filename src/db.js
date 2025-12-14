import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();


const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST,
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME,
  
  timezone: 'Z',
  
  // Configurações de pool otimizadas
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  
  // Timeout para prevenir conexões penduradas
  connectTimeout: 10000, // 10 segundos
  
  // Previne SQL injection através de prepared statements
  multipleStatements: false, // Desabilita múltiplos statements
  
  // Configurações de charset seguras
  charset: 'utf8mb4',
  
  // Pool event handlers para monitoring
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export default pool;