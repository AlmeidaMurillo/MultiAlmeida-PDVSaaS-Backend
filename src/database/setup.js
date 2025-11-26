import pool from "../db.js";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

// Função segura para configurar o banco de dados.
// Não apaga tabelas, apenas cria se não existirem.
async function setupDatabase() {
  try {
    console.log("Verificando a estrutura do banco de dados...");

    await pool.execute(`
            CREATE TABLE IF NOT EXISTS empresas (
                id VARCHAR(36) PRIMARY KEY,
                nome VARCHAR(200) NOT NULL,
                email VARCHAR(200),
                cnpj VARCHAR(20),
                telefone VARCHAR(30),
                endereco VARCHAR(300),
                cidade VARCHAR(100),
                estado VARCHAR(2),
                cep VARCHAR(10),
                periodo VARCHAR(20),
                plano VARCHAR(100),
                plano_id VARCHAR(36),
                status VARCHAR(20) DEFAULT 'Pendente',
                data_vencimento DATE,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

    await pool.execute(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id VARCHAR(36) PRIMARY KEY,
                nome VARCHAR(200) NOT NULL,
                email VARCHAR(200) NOT NULL UNIQUE,
                senha VARCHAR(255),
                papel VARCHAR(50) NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

    await pool.execute(`
            CREATE TABLE IF NOT EXISTS sessoes_usuarios (
                id VARCHAR(36) PRIMARY KEY,
                usuario_id VARCHAR(36) NOT NULL,
                hash_token VARCHAR(255) NOT NULL UNIQUE,
                criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expira_em DATETIME NOT NULL,
                info_dispositivo VARCHAR(255),
                info_navegador VARCHAR(255),
                endereco_ip VARCHAR(45),
                ultimo_acesso TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                esta_ativo BOOLEAN NOT NULL DEFAULT TRUE,
                papel VARCHAR(50) NOT NULL,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
            )
        `);

    await pool.execute(`
            CREATE TABLE IF NOT EXISTS planos (
                id VARCHAR(36) PRIMARY KEY,
                nome VARCHAR(255) NOT NULL,
                periodo ENUM('mensal', 'trimestral', 'semestral', 'anual') NOT NULL,
                preco DECIMAL(10, 2) NOT NULL,
                duracao_dias INT NOT NULL,
                beneficios JSON NOT NULL,
                quantidade_empresas INT NOT NULL DEFAULT 1,
                empresas_usando INT DEFAULT 0,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_nome_periodo (nome, periodo)
            )
        `);

    await pool.execute(`
            CREATE TABLE IF NOT EXISTS assinaturas (
                id VARCHAR(36) PRIMARY KEY,
                usuario_id VARCHAR(36) NOT NULL,
                plano_id VARCHAR(36) NOT NULL,
                status ENUM('pendente', 'ativa', 'inativa', 'cancelada', 'vencida') NOT NULL DEFAULT 'pendente',
                data_assinatura TIMESTAMP NULL,
                data_vencimento TIMESTAMP NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
                FOREIGN KEY (plano_id) REFERENCES planos(id) ON DELETE RESTRICT
            )
        `);

    await pool.execute(`
            CREATE TABLE IF NOT EXISTS pagamentos_assinatura (
                id VARCHAR(36) PRIMARY KEY,
                assinatura_id VARCHAR(36) NOT NULL,
                valor DECIMAL(10, 2) NOT NULL,
                metodo_pagamento VARCHAR(50) NOT NULL,
                status_pagamento ENUM('pendente', 'aprovado', 'reprovado', 'expirado', 'cancelado') DEFAULT 'pendente',
                transaction_id VARCHAR(255),
                data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                data_pagamento TIMESTAMP NULL,
                data_expiracao TIMESTAMP NULL,
                qr_code TEXT,
                qr_code_text TEXT,
                init_point VARCHAR(255),
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (assinatura_id) REFERENCES assinaturas(id) ON DELETE CASCADE
            )
        `);

    await pool.execute(`
            CREATE TABLE IF NOT EXISTS usuario_empresas (
                id VARCHAR(36) PRIMARY KEY,
                usuario_id VARCHAR(36) NOT NULL,
                empresa_id VARCHAR(36) NOT NULL,
                papel ENUM('dono','admin','colaborador') DEFAULT 'colaborador',
                forcar_troca_senha BOOLEAN DEFAULT TRUE,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
                FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
                UNIQUE KEY unique_usuario_empresa (usuario_id, empresa_id)
            )
        `);

    await pool.execute(`
            CREATE TABLE IF NOT EXISTS carrinho_usuarios (
                id VARCHAR(36) PRIMARY KEY,
                usuario_id VARCHAR(36) NOT NULL,
                plano_id VARCHAR(36) NOT NULL,
                periodo VARCHAR(20) NOT NULL,
                quantidade INT DEFAULT 1,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
                FOREIGN KEY (plano_id) REFERENCES planos(id) ON DELETE CASCADE,
                UNIQUE KEY unique_usuario_plano_periodo (usuario_id, plano_id, periodo)
            )
        `);

    // Cria usuário admin padrão, se não existir
    const [users] = await pool.execute(
      "SELECT * FROM usuarios WHERE email = 'admin@multialmeida.com'"
    );
    if (Array.isArray(users) && users.length === 0) {
      console.log("Criando usuário admin padrão...");
      const adminId = uuidv4();
      const senhaHash = await bcrypt.hash("admin123", 10);
      await pool.execute(
        "INSERT INTO usuarios (id, nome, email, senha, papel) VALUES (?, ?, ?, ?, ?)",
        [adminId, "Administrador", "admin@multialmeida.com", senhaHash, "admin"]
      );
    }

    // Cria planos padrão, se não existirem
    const [planosExistentes] = await pool.execute(
      "SELECT * FROM planos LIMIT 1"
    );
    if (Array.isArray(planosExistentes) && planosExistentes.length === 0) {
      console.log("Criando planos padrão...");
      const planosPadrao = [
        {
          nome: "Básico",
          periodo: "mensal",
          preco: 0.1,
          duracao: 30,
          beneficios: '["1 usuário", "Relatório simples"]',
          quantidade_empresas: 1,
        },
        // ... (todos os outros planos)
        {
          nome: "Premium",
          periodo: "anual",
          preco: 1499.9,
          duracao: 365,
          beneficios:
            '["Usuários ilimitados", "Relatórios completos", "Suporte 24/7", "Controle de estoque completo", "Módulo fiscal", "Gestão de múltiplas filiais"]',
          quantidade_empresas: 10,
        },
      ];

      for (const plano of planosPadrao) {
        await pool.execute(
          "INSERT INTO planos (id, nome, periodo, preco, duracao_dias, beneficios, quantidade_empresas) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            uuidv4(),
            plano.nome,
            plano.periodo,
            plano.preco,
            plano.duracao,
            plano.beneficios,
            plano.quantidade_empresas,
          ]
        );
      }
    }
    
    console.log("✅ Verificação do banco de dados concluída.");
  } catch (error) {
    console.error("❌ Erro durante a configuração do banco de dados:", error);
    throw error;
  }
}

export default setupDatabase;