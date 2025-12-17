import pool from '../db.js';

/**
 * GET /api/admin/logs
 * Retorna logs do sistema com filtros
 */
export const getLogs = async (req, res) => {
  try {
    const {
      tipo,
      usuario_id,
      email,
      ip,
      data_inicio,
      data_fim,
      limite = 100,
      pagina = 1,
    } = req.query;

    // Validar limite e página
    const limiteNum = Math.min(Math.max(parseInt(limite) || 100, 1), 1000);
    const paginaNum = Math.max(parseInt(pagina) || 1, 1);

    let query = 'SELECT * FROM logs_sistema WHERE 1=1';
    const params = [];

    if (tipo) {
      query += ' AND tipo = ?';
      params.push(tipo);
    }

    if (usuario_id) {
      query += ' AND usuario_id = ?';
      params.push(usuario_id);
    }

    if (email) {
      query += ' AND email LIKE ?';
      params.push(`%${email}%`);
    }

    if (ip) {
      query += ' AND ip = ?';
      params.push(ip);
    }

    if (data_inicio) {
      query += ' AND criado_em >= ?';
      params.push(data_inicio);
    }

    if (data_fim) {
      query += ' AND criado_em <= ?';
      params.push(data_fim);
    }

    // Contar total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const [countResult] = await pool.execute(countQuery, params);
    const total = countResult[0]?.total || 0;

    // Paginação
    const offset = (paginaNum - 1) * limiteNum;
    query += ' ORDER BY criado_em DESC LIMIT ? OFFSET ?';
    params.push(limiteNum, offset);

    const [logs] = await pool.execute(query, params);

    // Parse JSON detalhes com segurança
    const logsFormatados = logs.map(log => {
      let detalhes = null;
      if (log.detalhes) {
        try {
          // Se já for objeto, mantém; se for string, faz parse
          detalhes = typeof log.detalhes === 'string' 
            ? JSON.parse(log.detalhes) 
            : log.detalhes;
        } catch (e) {
          console.warn('⚠️ Erro ao fazer parse de detalhes do log:', log.id, e.message);
          detalhes = { erro: 'Dados corrompidos' };
        }
      }
      return {
        ...log,
        detalhes,
      };
    });

    res.json({
      success: true,
      data: logsFormatados,
      pagination: {
        total,
        pagina: paginaNum,
        limite: limiteNum,
        totalPaginas: Math.ceil(total / limiteNum),
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar logs:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      error: 'Erro ao buscar logs do sistema',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * GET /api/admin/logs/stats
 * Retorna estatísticas dos logs
 */
export const getLogsStats = async (req, res) => {
  try {
    const { periodo = 30 } = req.query;

    // Total por tipo
    const [porTipo] = await pool.execute(`
      SELECT tipo, COUNT(*) as total
      FROM logs_sistema
      WHERE criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY tipo
      ORDER BY total DESC
    `, [parseInt(periodo)]);

    // Top usuários
    const [topUsuarios] = await pool.execute(`
      SELECT email, COUNT(*) as total
      FROM logs_sistema
      WHERE criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND email IS NOT NULL
      GROUP BY email
      ORDER BY total DESC
      LIMIT 10
    `, [parseInt(periodo)]);

    // Top IPs
    const [topIPs] = await pool.execute(`
      SELECT ip, COUNT(*) as total
      FROM logs_sistema
      WHERE criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND ip IS NOT NULL
      GROUP BY ip
      ORDER BY total DESC
      LIMIT 10
    `, [parseInt(periodo)]);

    // Total geral
    const [totalGeral] = await pool.execute(`
      SELECT COUNT(*) as total
      FROM logs_sistema
      WHERE criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [parseInt(periodo)]);

    // Logs por dia (últimos 7 dias)
    const [porDia] = await pool.execute(`
      SELECT 
        DATE(criado_em) as data,
        COUNT(*) as total
      FROM logs_sistema
      WHERE criado_em >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(criado_em)
      ORDER BY data DESC
    `);

    res.json({
      success: true,
      data: {
        total: totalGeral[0].total,
        porTipo,
        topUsuarios,
        topIPs,
        porDia,
        periodo: parseInt(periodo),
      },
    });
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({
      error: 'Erro ao buscar estatísticas',
    });
  }
};

/**
 * DELETE /api/admin/logs
 * Limpa logs antigos
 */
export const deleteLogs = async (req, res) => {
  try {
    const { dias = 90 } = req.body;

    const [result] = await pool.execute(`
      DELETE FROM logs_sistema
      WHERE criado_em < DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [parseInt(dias)]);

    res.json({
      success: true,
      message: `${result.affectedRows} logs removidos com sucesso`,
      removidos: result.affectedRows,
    });
  } catch (error) {
    console.error('❌ Erro ao limpar logs:', error);
    res.status(500).json({
      error: 'Erro ao limpar logs',
    });
  }
};
