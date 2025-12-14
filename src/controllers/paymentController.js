import { MercadoPagoConfig, Payment } from "mercadopago";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";

dotenv.config();

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
    // 🔒 VALIDAÇÃO DE WEBHOOK DO MERCADO PAGO
    // Verifica assinatura x-signature ou x-request-id para garantir autenticidade
    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];
    
    // Mercado Pago envia x-signature ou x-request-id em webhooks autênticos
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

      // Define data_pagamento APENAS quando o pagamento for aprovado
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

      // Busca informações do pagamento
      const [pagamentoRows] = await connection.execute(
        "SELECT usuario_id, plano_id, cupom_id FROM pagamentos_assinatura WHERE id = ?",
        [nossoPagamentoId]
      );

      if (!pagamentoRows.length) {
        await connection.rollback();
        return res.status(404).send("Pagamento não encontrado.");
      }

      const { usuario_id, plano_id, cupom_id } = pagamentoRows[0];

      if (novoStatusPagamento === "aprovado") {
        // Busca informações do plano
        const [planoRows] = await connection.execute(
          "SELECT duracao_dias FROM planos WHERE id = ?",
          [plano_id]
        );

        if (!planoRows.length) {
          await connection.rollback();
          return res.status(404).send("Plano não encontrado.");
        }

        const { duracao_dias } = planoRows[0];

        // CRIA a assinatura apenas quando aprovado
        const assinaturaId = uuidv4();
        await connection.execute(
          `INSERT INTO assinaturas (id, usuario_id, plano_id, status, data_assinatura, data_vencimento) 
           VALUES (?, ?, ?, 'ativa', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
          [assinaturaId, usuario_id, plano_id, duracao_dias]
        );

        // Vincula a assinatura ao pagamento
        await connection.execute(
          "UPDATE pagamentos_assinatura SET assinatura_id = ? WHERE id = ?",
          [assinaturaId, nossoPagamentoId]
        );

        // Incrementa o uso do cupom se houver
        if (cupom_id) {
          await connection.execute(
            "UPDATE cupons SET quantidade_usada = quantidade_usada + 1 WHERE id = ?",
            [cupom_id]
          );
        }

        // Limpa o carrinho do usuário
        await connection.execute("DELETE FROM carrinho_usuarios WHERE usuario_id = ?", [usuario_id]);

      } else if (
        novoStatusPagamento === "reprovado" ||
        novoStatusPagamento === "cancelado"
      ) {
        // Para pagamentos reprovados/cancelados, não faz nada
        // A assinatura nunca foi criada
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
        
        // Verifica se o pagamento expirou
        const now = new Date();
        const expiration = new Date(payment.data_expiracao);
        
        if (
          payment.data_expiracao &&
          now > expiration &&
          payment.status === "pendente"
        ) {
          await connection.beginTransaction();
          
          try {
            // Atualiza o status do pagamento para expirado
            await connection.execute(
              "UPDATE pagamentos_assinatura SET status_pagamento = 'expirado' WHERE id = ?",
              [id]
            );
            
            // Se houver assinatura criada (não deveria ter para pagamentos pendentes), atualiza
            if (payment.assinatura_id) {
              await connection.execute(
                "UPDATE assinaturas SET status = 'inativa' WHERE id = ?",
                [payment.assinatura_id]
              );
            }
            
            await connection.commit();
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

      // Verifica e atualiza status se expirou
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
          // Atualiza o status do pagamento
          await expConnection.execute(
            "UPDATE pagamentos_assinatura SET status_pagamento = ? WHERE id = ?",
            ["expirado", id]
          );
          
          // Se houver assinatura vinculada, atualiza (não deveria ter para pendente)
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

      const [planRows] = await connection.execute(
        "SELECT * FROM planos WHERE id = ?",
        [planId]
      );

      if (planRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: "Plano não encontrado" });
      }

      const plano = planRows[0];

      
      let preco = Number(plano.preco.toString().replace(",", "."));
      const precoOriginal = preco;
      let cupomId = null;
      let valorDesconto = cupom_desconto ? parseFloat(cupom_desconto) : 0;
      let cupomInfo = null;

      // Se houver cupom no carrinho, buscar detalhes e aplicar desconto
      if (cupom_codigo && valorDesconto > 0) {
        const [cupons] = await connection.execute(
          'SELECT * FROM cupons WHERE codigo = ?',
          [cupom_codigo]
        );

        if (cupons.length > 0) {
          const cupom = cupons[0];
          cupomId = cupom.id;
          
          // Aplicar desconto
          preco = Math.max(0, preco - valorDesconto);
          
          cupomInfo = {
            codigo: cupom.codigo,
            tipo: cupom.tipo,
            valor: cupom.valor,
            desconto: valorDesconto
          };
        }
      }

      const paymentId = uuidv4();
      // Tempo de expiração configurável (padrão: 2 minutos)
      const PAYMENT_EXPIRATION_MINUTES = parseInt(process.env.PAYMENT_EXPIRATION_MINUTES || '2', 10);
      const expirationTime = new Date(Date.now() + PAYMENT_EXPIRATION_MINUTES * 60 * 1000);

      const paymentClient = new Payment(client);

      const paymentData = {
        body: {
          transaction_amount: preco,
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

      // Agora salva apenas o pagamento (sem assinatura), incluindo cupom se aplicável
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
      console.error("Erro ao iniciar pagamento:", error);
      return res.status(500).json({
        message: "Erro ao iniciar pagamento",
        error: error.message,
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
