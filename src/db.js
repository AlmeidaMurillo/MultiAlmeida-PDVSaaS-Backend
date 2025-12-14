import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// Cria o pool original
const originalPool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST,
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME,
  
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Função para ajustar datas JavaScript para compensar o UTC do Railway
const adjustDateForRailway = (date) => {
  if (!(date instanceof Date)) return date;
  // Subtrai 3 horas para compensar o UTC+0 do Railway
  return new Date(date.getTime() - (3 * 60 * 60 * 1000));
};

// Função para ajustar arrays de parâmetros
const adjustParams = (params) => {
  if (!params) return params;
  if (!Array.isArray(params)) return params;
  
  return params.map(param => {
    if (param instanceof Date) {
      return adjustDateForRailway(param);
    }
    return param;
  });
};

// Wrapper para o método getConnection que intercepta e ajusta timezone
const originalGetConnection = originalPool.getConnection.bind(originalPool);

// Cria um proxy do pool que intercepta todas as operações
const pool = new Proxy(originalPool, {
  get(target, prop) {
    // Intercepta getConnection para configurar timezone em cada conexão
    if (prop === 'getConnection') {
      return async () => {
        const connection = await originalGetConnection();
        
        // Configura timezone imediatamente
        await connection.query("SET time_zone = '-03:00'").catch(() => {});
        
        // Cria proxy da conexão para interceptar execute e query
        const connectionProxy = new Proxy(connection, {
          get(connTarget, connProp) {
            if (connProp === 'execute' || connProp === 'query') {
              return async (sql, params) => {
                const adjustedParams = adjustParams(params);
                return connTarget[connProp](sql, adjustedParams);
              };
            }
            return connTarget[connProp];
          }
        });
        
        return connectionProxy;
      };
    }
    
    // Intercepta execute e query diretos do pool
    if (prop === 'execute' || prop === 'query') {
      return async (sql, params) => {
        const adjustedParams = adjustParams(params);
        return target[prop](sql, adjustedParams);
      };
    }
    
    return target[prop];
  }
});

export default pool;