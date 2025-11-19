import pool from "../db.js";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

// Execute: npm run setup

async function setup() {
    try {
        console.log("🔄 Dropando tabelas antigas...");
        await pool.execute("SET FOREIGN_KEY_CHECKS = 0");

        await pool.execute("DROP TABLE IF EXISTS pagamentos_assinatura");
        await pool.execute("DROP TABLE IF EXISTS assinaturas");
        await pool.execute("DROP TABLE IF EXISTS pagamentos");
        await pool.execute("DROP TABLE IF EXISTS usuario_empresas");
        await pool.execute("DROP TABLE IF EXISTS usuarios");
        await pool.execute("DROP TABLE IF EXISTS empresas");
        await pool.execute("DROP TABLE IF EXISTS planos");
        await pool.execute("DROP TABLE IF EXISTS admins");
        await pool.execute("DROP TABLE IF EXISTS carrinho_usuarios");
        await pool.execute("SET FOREIGN_KEY_CHECKS = 1");
        console.log("✅ Tabelas dropadas\n");

        console.log("📦 Criando tabelas...");
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS admins (
                id VARCHAR(36) PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                senha VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

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
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
                status ENUM('pendente', 'ativa', 'inativa', 'cancelada') NOT NULL DEFAULT 'pendente',
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

        // Cria admin padrão
        const [admins] = await pool.execute("SELECT * FROM admins LIMIT 1");
        if (Array.isArray(admins) && admins.length === 0) {
            const adminId = uuidv4();
            const senhaHash = await bcrypt.hash("admin123", 10);
            await pool.execute(
                "INSERT INTO admins (id, nome, email, senha) VALUES (?, ?, ?, ?)",
                [adminId, "Administrador", "admin@multialmeida.com", senhaHash]
            );

            console.log("👑 Admin padrão criado com sucesso!");
            console.log("   Email: admin@multialmeida.com");
            console.log("   Senha: admin123");
        }

        // Cria planos padrão
        const [planosExistentes] = await pool.execute("SELECT * FROM planos LIMIT 1");
        if (Array.isArray(planosExistentes) && planosExistentes.length === 0) {
            console.log("\n📊 Criando planos padrão...");

            const planosPadrao = [
                { nome: "Básico", periodo: "mensal", preco: 0.10, duracao: 30, beneficios: '["1 usuário", "Relatório simples"]', quantidade_empresas: 1 },
                { nome: "Básico", periodo: "trimestral", preco: 139.9, duracao: 90, beneficios: '["1 usuário", "Relatório simples", "Suporte básico"]', quantidade_empresas: 1 },
                { nome: "Básico", periodo: "semestral", preco: 269.9, duracao: 180, beneficios: '["1 usuário", "Relatório simples", "Suporte básico", "Controle de estoque"]', quantidade_empresas: 1 },
                { nome: "Básico", periodo: "anual", preco: 499.9, duracao: 365, beneficios: '["1 usuário", "Relatório simples", "Suporte básico", "Controle de estoque", "Exportação de dados"]', quantidade_empresas: 1 },
                { nome: "Pro", periodo: "mensal", preco: 99.9, duracao: 30, beneficios: '["3 usuários", "Relatórios detalhados"]', quantidade_empresas: 3 },
                { nome: "Pro", periodo: "trimestral", preco: 279.9, duracao: 90, beneficios: '["3 usuários", "Relatórios detalhados", "Suporte via WhatsApp"]', quantidade_empresas: 3 },
                { nome: "Pro", periodo: "semestral", preco: 539.9, duracao: 180, beneficios: '["3 usuários", "Relatórios detalhados", "Suporte via WhatsApp", "Controle de estoque avançado"]', quantidade_empresas: 3 },
                { nome: "Pro", periodo: "anual", preco: 999.9, duracao: 365, beneficios: '["3 usuários", "Relatórios detalhados", "Suporte via WhatsApp", "Controle de estoque avançado", "Integração com caixa"]', quantidade_empresas: 3 },
                { nome: "Premium", periodo: "mensal", preco: 149.9, duracao: 30, beneficios: '["Usuários ilimitados", "Relatórios completos"]', quantidade_empresas: 10 },
                { nome: "Premium", periodo: "trimestral", preco: 419.9, duracao: 90, beneficios: '["Usuários ilimitados", "Relatórios completos", "Suporte 24/7"]', quantidade_empresas: 10 },
                { nome: "Premium", periodo: "semestral", preco: 809.9, duracao: 180, beneficios: '["Usuários ilimitados", "Relatórios completos", "Suporte 24/7", "Controle de estoque completo"]', quantidade_empresas: 10 },
                { nome: "Premium", periodo: "anual", preco: 1499.9, duracao: 365, beneficios: '["Usuários ilimitados", "Relatórios completos", "Suporte 24/7", "Controle de estoque completo", "Módulo fiscal", "Gestão de múltiplas filiais"]', quantidade_empresas: 10 },
            ];

            for (const plano of planosPadrao) {
                await pool.execute(
                    "INSERT INTO planos (id, nome, periodo, preco, duracao_dias, beneficios, quantidade_empresas) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [uuidv4(), plano.nome, plano.periodo, plano.preco, plano.duracao, plano.beneficios, plano.quantidade_empresas]
                );
            }

            console.log("✅ Planos padrão criados com sucesso!");
        }

        console.log("\n🎉 Setup concluído com sucesso!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Erro durante o setup:", error);
        process.exit(1);
    }
}

setup();
