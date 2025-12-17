import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();


const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST,
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME,
  
  timezone: 'Z',
  
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  
  connectTimeout: 10000, 
  
  multipleStatements: false, 
  
  charset: 'utf8mb4',
  
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export default pool;