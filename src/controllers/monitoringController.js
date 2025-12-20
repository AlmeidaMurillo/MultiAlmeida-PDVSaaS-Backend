import pool from '../db.js';


export const getLogs = async (req, res) => {
  try {
    const {
      tipo,
      usuario_id,
      email,
      nome,
      cargo,
      ip,
      data_inicio,
      data_fim,
      limite = 100,
      pagina = 1,
      severidade,
    } = req.query;

    console.log('🔍 Filtros recebidos:', { tipo, usuario_id, email, nome, cargo, ip, data_inicio, data_fim, limite, pagina, severidade });

    // Mapeamento de severidade para tipos de log
    const SEVERIDADE_TIPOS = {
      info: ['login', 'logout', 'sessao', 'acesso', 'carrinho_adicionar', 'carrinho_remover', 'carrinho_limpar', 'cupom_removido', 'admin', 'admin_cupom', 'admin_plano', 'admin_empresa', 'admin_usuario'],
      success: ['registro', 'pagamento', 'compra', 'cupom_aplicado', 'perfil_atualizado'],
      warning: ['rate_limit', 'cupom_invalido', 'senha_alterada', 'tentativa_acesso', 'validacao_falha', 'sessao_expirada'],
      error: ['erro', 'ataque_detectado', 'token_invalido'],
    };

    // Validar limite e página
    const limiteNum = Math.min(Math.max(parseInt(limite) || 100, 1), 1000);
    const paginaNum = Math.max(parseInt(pagina) || 1, 1);

    let query = 'SELECT * FROM logs_sistema WHERE 1=1';
    const params = [];

    if (tipo) {
      query += ' AND tipo = ?';
      params.push(tipo);
    }

    // Filtrar por severidade
    if (severidade && SEVERIDADE_TIPOS[severidade]) {
      const tipos = SEVERIDADE_TIPOS[severidade];
      const placeholders = tipos.map(() => '?').join(',');
      query += ` AND tipo IN (${placeholders})`;
      params.push(...tipos);
    }

    if (usuario_id) {
      query += ' AND usuario_id = ?';
      params.push(usuario_id);
    }

    if (email) {
      query += ' AND email LIKE ?';
      params.push(`%${email}%`);
      console.log('📧 Filtrando por email:', email);
    }

    if (nome) {
      query += ' AND nome LIKE ?';
      params.push(`%${nome}%`);
      console.log('👤 Filtrando por nome:', nome);
    }

    if (cargo) {
      query += ' AND cargo LIKE ?';
      params.push(`%${cargo}%`);
    }

    if (ip) {
      query += ' AND ip LIKE ?';
      params.push(`%${ip}%`);
    }

    if (data_inicio) {
      query += ' AND criado_em >= ?';
      params.push(data_inicio);
      console.log('📅 Filtrando data_inicio:', data_inicio);
    }

    if (data_fim) {
      query += ' AND criado_em <= ?';
      params.push(data_fim);
      console.log('📅 Filtrando data_fim:', data_fim);
    }

    // Contar total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    console.log('📊 Query COUNT:', countQuery);
    console.log('📊 Params:', params);
    const [countResult] = await pool.execute(countQuery, params);
    const total = countResult[0]?.total || 0;
    console.log('📊 Total encontrado:', total);

    // Paginação - usar interpolação direta ao invés de placeholders para LIMIT/OFFSET
    const offset = (paginaNum - 1) * limiteNum;
    query += ` ORDER BY criado_em DESC LIMIT ${limiteNum} OFFSET ${offset}`;

    console.log('📊 Query final:', query);
    const [logs] = await pool.execute(query, params);
    console.log('📊 Logs encontrados:', logs.length);

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

    // Eventos por dia (últimos 30 dias para gráfico)
    const [eventosPorDia] = await pool.execute(`
      SELECT 
        DATE(criado_em) as data,
        COUNT(*) as total
      FROM logs_sistema
      WHERE criado_em >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(criado_em)
      ORDER BY data DESC
    `);

    // Eventos por hora do dia (últimas 24h)
    const [eventosPorHora] = await pool.execute(`
      SELECT 
        HOUR(criado_em) as hora,
        COUNT(*) as total
      FROM logs_sistema
      WHERE criado_em >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY HOUR(criado_em)
      ORDER BY hora
    `);

    // Logs por dia (últimos 7 dias) - mantido para compatibilidade
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
        eventosPorDia,
        eventosPorHora,
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
