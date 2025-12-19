import { MercadoPagoConfig, Payment } from "mercadopago";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { logPagamento, logCompra } from "../utils/logger.js";

dotenv.config();

if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
  console.error('❌ MERCADO_PAGO_ACCESS_TOKEN não está definido nas variáveis de ambiente');
  throw new Error('Configuração do Mercado Pago está incompleta');
}

if (!process.env.BACKEND_URL) {
  console.warn('⚠️ BACKEND_URL não está definido nas variáveis de ambiente');
}

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
});

class PaymentController {
  
  async generateQrCode(req, res) {
    const { amount, description } = req.body;

    if (!amount) {
      return res.status(400).json({
        message: "Dados obrigatórios: amount",
      });
    }

    try {
      const payment = new Payment(client);
      const paymentData = {
        body: {
          transaction_amount: Number(amount),
          description: description || `Pagamento`,
          payment_method_id: "pix",
          payer: {
            email: "test@test.com",
          },
        },
      };

      const paymentResponse = await payment.create(paymentData);

      const qrCodeBase64 =
        paymentResponse.point_of_interaction?.transaction_data
          ?.qr_code_base64 || "";

      return res.status(200).json({
        qrCodeImage: `data:image/png;base64,${qrCodeBase64}`,
      });
    } catch (error) {
      console.error("Erro ao gerar QR Code PIX:", error);
      return res.status(500).json({
        message: "Erro ao gerar QR Code",
        error: error.message,
        details: error.response?.data || error,
      });
    }
  }

  
  async handleWebhook(req, res) {
    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];
    
    if (!xSignature && !xRequestId) {
      console.warn('⚠️ Webhook recebido sem assinatura do Mercado Pago', {
        ip: req.ip,
        headers: req.headers
      });
      return res.status(401).json({ error: 'Webhook não autorizado' });
    }

    let paymentId;
    let notificationType;

    if (req.body && req.body.action && req.body.action.startsWith("payment.")) {
      paymentId = req.body.data?.id;
      notificationType = req.body.type;
    } else if (req.query && req.query["data.id"]) {
      notificationType = req.query.type;
      if (notificationType === "payment") {
        paymentId = req.query["data.id"];
      }
    }

    if (notificationType !== "payment" || !paymentId) {
      return res.status(200).send("Evento ignorado.");
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: paymentId });

      if (!payment || !payment.external_reference) {
        await connection.rollback();
        return res
          .status(404)
          .send("Pagamento não encontrado ou sem referência externa.");
      }

      const nossoPagamentoId = payment.external_reference;
      const novoStatusPagamento =
        payment.status === "approved"
          ? "aprovado"
          : payment.status === "rejected"
          ? "reprovado"
          : payment.status === "cancelled"
          ? "cancelado"
          : "pendente";

      const updateQuery = novoStatusPagamento === "aprovado"
        ? "UPDATE pagamentos_assinatura SET status_pagamento = ?, data_pagamento = NOW(), transaction_id = ? WHERE id = ?"
        : "UPDATE pagamentos_assinatura SET status_pagamento = ?, transaction_id = ? WHERE id = ?";
      
      const updateParams = novoStatusPagamento === "aprovado"
        ? [novoStatusPagamento, payment.id, nossoPagamentoId]
        : [novoStatusPagamento, payment.id, nossoPagamentoId];

      const [updateResult] = await connection.execute(updateQuery, updateParams);

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).send("Registro interno não encontrado.");
      }

      const [pagamentoRows] = await connection.execute(
        "SELECT usuario_id, plano_id, cupom_id, valor FROM pagamentos_assinatura WHERE id = ?",
        [nossoPagamentoId]
      );

      if (!pagamentoRows.length) {
        await connection.rollback();
        return res.status(404).send("Pagamento não encontrado.");
      }

      const { usuario_id, plano_id, cupom_id, valor } = pagamentoRows[0];

      if (novoStatusPagamento === "aprovado") {
        const [planoRows] = await connection.execute(
          "SELECT nome, periodo, preco, duracao_dias FROM planos WHERE id = ?",
          [plano_id]
        );
        
        const [usuarioRows] = await connection.execute(
          "SELECT nome, email FROM usuarios WHERE id = ?",
          [usuario_id]
        );
        
        let detalhesLog = {
          pagamento_id: nossoPagamentoId,
          mercadopago_payment_id: payment.id,
          status_pagamento: 'aprovado',
          valor_pago: parseFloat(valor),
          plano: {
            nome: planoRows[0]?.nome || 'N/A',
            periodo: planoRows[0]?.periodo || 'N/A',
            duracao_dias: planoRows[0]?.duracao_dias || 0
          },
          metodo_pagamento: payment.payment_method_id || 'N/A',
          usuario: {
            id: usuario_id,
            nome: usuarioRows[0]?.nome || 'N/A',
            email: usuarioRows[0]?.email || 'N/A'
          },
          assinatura_criada: true,
          assinatura_id: null
        };
        
        if (cupom_id) {
          const [cupomRows] = await connection.execute(
            "SELECT codigo, tipo, valor FROM cupons WHERE id = ?",
            [cupom_id]
          );
          if (cupomRows.length > 0) {
            detalhesLog.cupom = {
              codigo: cupomRows[0].codigo,
              tipo: cupomRows[0].tipo,
              valor: parseFloat(cupomRows[0].valor)
            };
          }
        }
        
        const { duracao_dias } = planoRows[0];

        const assinaturaId = uuidv4();
        await connection.execute(
          `INSERT INTO assinaturas (id, usuario_id, plano_id, status, data_assinatura, data_vencimento) 
           VALUES (?, ?, ?, 'ativa', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
          [assinaturaId, usuario_id, plano_id, duracao_dias]
        );

        await connection.execute(
          "UPDATE pagamentos_assinatura SET assinatura_id = ? WHERE id = ?",
          [assinaturaId, nossoPagamentoId]
        );
        
        // Adicionar ID da assinatura ao log
        detalhesLog.assinatura_id = assinaturaId;
        detalhesLog.data_vencimento = new Date(Date.now() + duracao_dias * 24 * 60 * 60 * 1000).toISOString();
        
        await log('pagamento', req, 'Pagamento aprovado', detalhesLog, { id: usuario_id, email: usuarioRows[0]?.email, nome: usuarioRows[0]?.nome });

        if (cupom_id) {
          await connection.execute(
            "UPDATE cupons SET quantidade_usada = quantidade_usada + 1 WHERE id = ?",
            [cupom_id]
          );
        }

        await connection.execute("DELETE FROM carrinho_usuarios WHERE usuario_id = ?", [usuario_id]);

      } else if (
        novoStatusPagamento === "reprovado" ||
        novoStatusPagamento === "cancelado"
      ) {
      }

      await connection.commit();
      return res.status(200).send("Webhook processado com sucesso.");
    } catch (error) {
      await connection.rollback();
      console.error("Erro no webhook:", error);
      return res
        .status(500)
        .json({ message: "Erro ao processar webhook", error: error.message });
    } finally {
      connection.release();
    }
  }

  
  async getPaymentStatus(req, res) {
    const connection = await pool.getConnection();
    
    try {
      const { id } = req.params;
      const [pagamento] = await connection.execute(
        "SELECT status_pagamento as status, data_expiracao, assinatura_id FROM pagamentos_assinatura WHERE id = ?",
        [id]
      );

      if (Array.isArray(pagamento) && pagamento.length > 0) {
        const payment = pagamento[0];
        
        const now = new Date();
        const expiration = new Date(payment.data_expiracao);
        
        if (
          payment.data_expiracao &&
          now > expiration &&
          payment.status === "pendente"
        ) {
          await connection.beginTransaction();
          
          try {
            await connection.execute(
              "UPDATE pagamentos_assinatura SET status_pagamento = 'expirado' WHERE id = ?",
              [id]
            );
            
            // Buscar detalhes do pagamento para log
            const [pagDetalhes] = await connection.execute(
              "SELECT pa.usuario_id, pa.valor, pl.nome as plano_nome, u.email, u.nome as usuario_nome FROM pagamentos_assinatura pa LEFT JOIN planos pl ON pa.plano_id = pl.id LEFT JOIN usuarios u ON pa.usuario_id = u.id WHERE pa.id = ?",
              [id]
            );
            
            if (payment.assinatura_id) {
              await connection.execute(
                "UPDATE assinaturas SET status = 'inativa' WHERE id = ?",
                [payment.assinatura_id]
              );
            }
            
            await connection.commit();
            
            // Log de pagamento expirado
            if (pagDetalhes.length > 0) {
              await log('pagamento', req, 'Pagamento expirado por tempo limite', {
                pagamento_id: id,
                status_anterior: 'pendente',
                status_novo: 'expirado',
                valor: parseFloat(pagDetalhes[0].valor),
                plano_nome: pagDetalhes[0].plano_nome,
                usuario: {
                  id: pagDetalhes[0].usuario_id,
                  nome: pagDetalhes[0].usuario_nome,
                  email: pagDetalhes[0].email
                },
                assinatura_id: payment.assinatura_id || null,
                assinatura_inativada: !!payment.assinatura_id,
                expirado_em: new Date().toISOString()
              }, { id: pagDetalhes[0].usuario_id, email: pagDetalhes[0].email, nome: pagDetalhes[0].usuario_nome });
            }
            
            payment.status = "expirado";
          } catch (err) {
            await connection.rollback();
            console.error('Erro ao atualizar status de expiração:', err);
            throw err;
          }
        }
        
        return res.status(200).json({ status: payment.status });
      } else {
        return res.status(404).json({ message: "Pagamento não encontrado" });
      }
    } catch (error) {
      await connection.rollback();
      return res
        .status(500)
        .json({ message: "Erro ao buscar status do pagamento", error });
    } finally {
      connection.release();
    }
  }

  
  async getPaymentDetails(req, res) {
    try {
      const { id } = req.params;
      const [pagamento] = await pool.execute(
        `SELECT 
            pa.id as paymentId, 
            pa.status_pagamento as status, 
            pa.qr_code as qrCode, 
            pa.qr_code_text as qrCodeText, 
            pa.data_expiracao as expirationTime,
            pa.usuario_id as usuarioId,
            pa.plano_id as planId,
            pa.valor as valorFinal,
            pa.valor_desconto as valorDesconto,
            pa.cupom_id as cupomId,
            p.nome as nomePlano,
            p.periodo as periodoPlano,
            p.preco as precoPlano,
            p.duracao_dias as duracaoDiasPlano,
            p.beneficios as beneficiosPlano,
            p.quantidade_empresas as quantidadeEmpresas,
            c.codigo as cupomCodigo,
            c.tipo as cupomTipo,
            c.valor as cupomValor
         FROM pagamentos_assinatura pa
         JOIN planos p ON pa.plano_id = p.id
         LEFT JOIN cupons c ON pa.cupom_id = c.id
         WHERE pa.id = ?`,
        [id]
      );

      if (!pagamento.length) {
        return res.status(404).json({ message: "Pagamento não encontrado" });
      }

      const data = pagamento[0];

      const now = new Date();
      const expiration = new Date(data.expirationTime);
      
      if (
        data.expirationTime &&
        now > expiration &&
        data.status === "pendente"
      ) {
        const expConnection = await pool.getConnection();
        await expConnection.beginTransaction();
        
        try {
          await expConnection.execute(
            "UPDATE pagamentos_assinatura SET status_pagamento = ? WHERE id = ?",
            ["expirado", id]
          );
          
          const [assinatura] = await expConnection.execute(
            "SELECT assinatura_id FROM pagamentos_assinatura WHERE id = ?",
            [id]
          );
          
          if (assinatura.length > 0 && assinatura[0].assinatura_id) {
            await expConnection.execute(
              "UPDATE assinaturas SET status = 'inativa' WHERE id = ?",
              [assinatura[0].assinatura_id]
            );
          }
          
          await expConnection.commit();
          data.status = "expirado";
        } catch (err) {
          await expConnection.rollback();
          console.error("Erro ao atualizar status de expiração:", err);
        } finally {
          expConnection.release();
        }
      }

      return res.status(200).json(data);
    } catch (error) {
      console.error("Erro ao buscar detalhes:", error);
      return res
        .status(500)
        .json({ message: "Erro ao buscar detalhes", error });
    }
  }

  
  async expirePayment(req, res) {
    const { id } = req.params;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [rows] = await connection.execute(
        "SELECT assinatura_id FROM pagamentos_assinatura WHERE id = ? AND status_pagamento = 'pendente'",
        [id]
      );

      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({
          message: "Pagamento pendente não encontrado ou já processado.",
        });
      }

      const { assinatura_id } = rows[0];

      await connection.execute(
        "UPDATE pagamentos_assinatura SET status_pagamento = 'expirado' WHERE id = ?",
        [id]
      );

      // Só atualiza assinatura se existir (não deveria existir para pendente)
      if (assinatura_id) {
        await connection.execute(
          "UPDATE assinaturas SET status = 'inativa' WHERE id = ?",
          [assinatura_id]
        );
      }

      await connection.commit();
      return res.status(200).json({
        message: "Pagamento expirado com sucesso",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Erro ao expirar:", error);
      return res
        .status(500)
        .json({ message: "Erro ao expirar pagamento", error });
    } finally {
      connection.release();
    }
  }

  
  async initiatePayment(req, res) {
    const usuarioId = req.user.id;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [cartItems] = await connection.execute(
        "SELECT plano_id, periodo, cupom_codigo, cupom_desconto FROM carrinho_usuarios WHERE usuario_id = ?",
        [usuarioId]
      );

      if (cartItems.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: "Carrinho vazio" });
      }

      const { plano_id: planId, periodo, cupom_codigo, cupom_desconto } = cartItems[0];

      if (!periodo || (periodo !== 'mensal' && periodo !== 'anual')) {
        console.error('❌ Período inválido:', periodo);
        await connection.rollback();
        return res.status(400).json({ 
          message: "Período inválido. Use 'mensal' ou 'anual'."
        });
      }

      const [planRows] = await connection.execute(
        "SELECT * FROM planos WHERE id = ? AND periodo = ?",
        [planId, periodo]
      );

      if (planRows.length === 0) {
        console.error('❌ Plano não encontrado:', { planId, periodo });
        await connection.rollback();
        return res.status(404).json({ 
          message: "Plano não encontrado para o período selecionado" 
        });
      }

      const plano = planRows[0];

      let preco = parseFloat(plano.preco.toString().replace(",", "."));
      
      if (isNaN(preco) || preco <= 0) {
        console.error('❌ Preço inválido:', { precoOriginal: plano.preco, precoConvertido: preco });
        await connection.rollback();
        return res.status(400).json({ 
          message: "Preço do plano inválido. Entre em contato com o suporte." 
        });
      }
      
      const precoOriginal = preco;
      let cupomId = null;
      let valorDesconto = cupom_desconto ? parseFloat(cupom_desconto) : 0;
      let cupomInfo = null;

      if (cupom_codigo && valorDesconto > 0) {
        const [cupons] = await connection.execute(
          'SELECT * FROM cupons WHERE codigo = ?',
          [cupom_codigo]
        );

        if (cupons.length > 0) {
          const cupom = cupons[0];
          cupomId = cupom.id;
          
          preco = Math.max(0, preco - valorDesconto);
          
          cupomInfo = {
            codigo: cupom.codigo,
            tipo: cupom.tipo,
            valor: cupom.valor,
            desconto: valorDesconto
          };
        } else {
          console.warn('⚠️ Cupom não encontrado:', cupom_codigo);
        }
      }

      if (preco <= 0) {
        console.error('❌ Preço final inválido (menor ou igual a zero):', preco);
        await connection.rollback();
        return res.status(400).json({ 
          message: "O valor final do pagamento é inválido. Verifique o cupom aplicado." 
        });
      }

      preco = Math.round(preco * 100) / 100;

      const paymentId = uuidv4();
      const PAYMENT_EXPIRATION_MINUTES = parseInt(process.env.PAYMENT_EXPIRATION_MINUTES || '2', 10);
      const expirationTime = new Date(Date.now() + PAYMENT_EXPIRATION_MINUTES * 60 * 1000);

      const paymentClient = new Payment(client);

      const paymentData = {
        body: {
          transaction_amount: Number(preco.toFixed(2)),
          description: `Assinatura ${plano.nome} - ${periodo}`,
          payment_method_id: "pix",
          payer: {
            email: req.user.email,
          },
          external_reference: paymentId,
          notification_url: `${process.env.BACKEND_URL}/api/payments/webhook`,
        },
      };

      const response = await paymentClient.create(paymentData);

      const qrCodeBase64 =
        response.point_of_interaction?.transaction_data?.qr_code_base64 || "";
      const qrCodeText =
        response.point_of_interaction?.transaction_data?.qr_code || "";

      await connection.execute(
        `INSERT INTO pagamentos_assinatura (
          id, usuario_id, plano_id, valor, metodo_pagamento, status_pagamento,
          data_expiracao, qr_code, qr_code_text, cupom_id, valor_desconto
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          paymentId,
          usuarioId,
          planId,
          preco,
          "pix",
          "pendente",
          expirationTime,
          qrCodeBase64,
          qrCodeText,
          cupomId,
          valorDesconto
        ]
      );

      await connection.commit();

      // Registrar log de pagamento criado
      await logPagamento(req, req.user, 'Pagamento PIX criado', {
        pagamento_id: paymentId,
        plano_nome: plano.nome,
        plano_id: planId,
        periodo,
        valor_final: preco,
        valor_original: precoOriginal,
        desconto_aplicado: valorDesconto,
        cupom_usado: cupomInfo ? {
          codigo: cupomInfo.codigo,
          tipo: cupomInfo.tipo,
          valor: cupomInfo.valor,
          desconto: cupomInfo.desconto
        } : null,
        metodo_pagamento: 'PIX',
        expira_em: expirationTime,
        usuario: {
          nome: req.user.nome,
          email: req.user.email
        },
        criado_em: new Date().toISOString()
      });

      return res.status(200).json({
        paymentId,
        qrCode: `data:image/png;base64,${qrCodeBase64}`,
        pixCode: qrCodeText,
        expirationTime,
        plan: {
          nome: plano.nome,
          periodo: plano.periodo,
          preco,
          precoOriginal: Number(plano.preco.toString().replace(",", ".")),
          duracaoDias: plano.duracao_dias,
          beneficios: plano.beneficios,
        },
        cupom: cupomInfo,
        user: {
          nome: req.user.nome,
          email: req.user.email,
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("❌ Erro ao iniciar pagamento:", {
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status,
        usuarioId: req.user?.id
      });
      
      // Verifica erros específicos
      if (error.message?.includes('Configuração do Mercado Pago')) {
        return res.status(500).json({
          message: "Erro de configuração do servidor. Entre em contato com o suporte.",
        });
      }
      
      if (error.response?.status === 401) {
        return res.status(500).json({
          message: "Erro de autenticação com o gateway de pagamento.",
        });
      }
      
      return res.status(500).json({
        message: "Erro ao iniciar pagamento. Tente novamente.",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    } finally {
      connection.release();
    }
  }

  async listAdminPayments(req, res) {
    try {
      const [payments] = await pool.execute(`
        SELECT
            pa.id,
            pa.transaction_id AS mercadopago_id,
            pa.valor,
            pa.status_pagamento AS status,
            pa.data_criacao,
            pa.data_pagamento,
            u.nome AS usuario_nome,
            u.email AS usuario_email,
            p.nome AS plano_nome,
            e.nome AS empresa_nome
        FROM
            pagamentos_assinatura pa
        LEFT JOIN
            usuarios u ON pa.usuario_id = u.id
        LEFT JOIN
            planos p ON pa.plano_id = p.id
        LEFT JOIN
            empresas e ON u.empresa_id = e.id
        ORDER BY
            pa.data_criacao DESC
      `);

      return res.status(200).json({ pagamentos: payments });
    } catch (error) {
      console.error("Erro ao listar pagamentos para o admin:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new PaymentController();
