import { FastifyInstance } from "fastify";
import pool from "../db";
import { validarJWT } from "./middleware";

interface CriarTransacaoBody {
    conta_id: number;
    descricao: string;
    valor: number;
    tipo: 'receita' | 'despesa';
    categoria: string;
    data_transacao?: string; // Formato YYYY-MM-DD
}

export async function transacoesRoutes(app: FastifyInstance) {

    app.post('/', { preHandler: [validarJWT] }, async (request, reply) => {
        const { conta_id, descricao, valor, tipo, categoria, data_transacao } = request.body as CriarTransacaoBody;
        const usuario_id = request.user.id;

        try {
            // 1. Validação de Permissão: O usuário pode postar nessa conta?
            const permissao = await pool.query(
                'SELECT papel FROM conta_usuarios WHERE conta_id = $1 AND usuario_id = $2',
                [conta_id, usuario_id]
            );

            if (permissao.rowCount === 0) {
                return reply.code(403).send({ error: "Você não tem acesso a esta conta." });
            }

            const papel = permissao.rows[0].papel;
            if (papel === 'leitura') {
                return reply.code(403).send({ error: "Seu nível de acesso é apenas de leitura." });
            }

            const query = `
            INSERT INTO transacoes (conta_id, usuario_id, descricao, valor, tipo, categoria, data_transacao, criado_por)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

            const values = [
                conta_id,
                usuario_id,
                descricao,
                valor,
                tipo,
                categoria,
                data_transacao || new Date().toISOString().split('T')[0],
                usuario_id
            ];

            const result = await pool.query(query, values);

            return reply.code(201).send(result.rows[0]);

        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao lançar transação." });
        }
    });

    app.delete('/:id', { preHandler: [validarJWT] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const usuario_id = request.user.id;
        try {
            // 1. Verificar se a transação existe e pertence a uma conta do usuário
            const transacao = await pool.query(
                `SELECT t.*, c.id AS conta_id 
                 FROM transacoes t 
                 JOIN contas c ON t.conta_id = c.id 
                 JOIN conta_usuarios cu ON c.id = cu.conta_id 
                 WHERE t.id = $1 AND cu.usuario_id = $2`,
                [id, usuario_id]
            );

            if (transacao.rowCount === 0) {
                return reply.code(404).send({ error: "Transação não encontrada ou acesso negado." });
            }

            const conta_id = transacao.rows[0].conta_id;

            const permissao = await pool.query(
                'SELECT papel FROM conta_usuarios WHERE conta_id = $1 AND usuario_id = $2',
                [conta_id, usuario_id]
            );
            if (permissao.rowCount === 0) {
                return reply.code(403).send({ error: "Você não tem acesso a esta conta." });
            }

            const papel = permissao.rows[0].papel;
            if (papel === 'leitura') {
                return reply.code(403).send({ error: "Seu nível de acesso é apenas de leitura." });
            }

            await pool.query('DELETE FROM transacoes WHERE id = $1', [id]);
            return reply.code(204).send();

        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao deletar transação." });
        }
    });

    app.put('/:id', { preHandler: [validarJWT] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { descricao, valor, tipo, categoria, data_transacao } = request.body as Partial<CriarTransacaoBody>;
        const usuario_id = request.user.id;

        try {
            // 1. Verificar se a transação existe e pertence a uma conta do usuário
            const transacao = await pool.query(
                `SELECT t.*, c.id AS conta_id 
                 FROM transacoes t 
                 JOIN contas c ON t.conta_id = c.id 
                 JOIN conta_usuarios cu ON c.id = cu.conta_id 
                 WHERE t.id = $1 AND cu.usuario_id = $2`,
                [id, usuario_id]
            );

            if (transacao.rowCount === 0) {
                return reply.code(404).send({ error: "Transação não encontrada ou acesso negado." });
            }

            const
                conta_id = transacao.rows[0].conta_id;

            const permissao = await pool.query(
                'SELECT papel FROM conta_usuarios WHERE conta_id = $1 AND usuario_id = $2',
                [conta_id, usuario_id]
            );
            if (permissao.rowCount === 0) {
                return reply.code(403).send({ error: "Você não tem acesso a esta conta." });
            }
            const papel = permissao.rows[0].papel;
            if (papel === 'leitura') {
                return reply.code(403).send({ error: "Seu nível de acesso é apenas de leitura." });
            }

            const campos: string[] = [];
            const valores: any[] = [];
            let idx = 1;

            if (descricao) {
                campos.push(`descricao = $${idx++}`);
                valores.push(descricao);
            }
            if (valor) {
                campos.push(`valor = $${idx++}`);
                valores.push(valor);
            }
            if (tipo) {
                campos.push(`tipo = $${idx++}`);
                valores.push(tipo);
            }
            if (categoria) {
                campos.push(`categoria = $${idx++}`);
                valores.push(categoria);
            }
            if (data_transacao) {
                campos.push(`data_transacao = $${idx++}`);
                valores.push(data_transacao);

                if (campos.length === 0) {
                    return reply.code(400).send({ error: "Nenhum campo para atualizar." });
                }

                const query = `UPDATE transacoes SET ${campos.join(', ')} WHERE id = $${idx} RETURNING *`;
                valores.push(id);

                const result = await pool.query(query, valores);

                return reply.send(result.rows[0]);

            }
        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao atualizar transação." });
        }
    });
}   