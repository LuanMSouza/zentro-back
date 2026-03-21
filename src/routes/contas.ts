import { FastifyInstance } from "fastify";
import pool from "../db";
import { validarJWT } from "./middleware";

interface CriarContaBody {
    nome: string;
    convidado_id: number
}

interface AdicionarMembroBody {
    usuario_id: number;
    papel?: 'admin' | 'editor' | 'leitura';
}

export async function contasRoutes(app: FastifyInstance) {

    app.get('/', { preHandler: [validarJWT] }, async (request, reply) => {
        const usuario_id = request.user.id;

        try {
            const query = `
            SELECT 
                c.id, 
                c.nome, 
                c.criado_em,
                cu.papel,
                u.nome as dono_da_conta
            FROM contas c
            JOIN conta_usuarios cu ON c.id = cu.conta_id
            JOIN usuarios u ON c.criado_por = u.id
            WHERE cu.usuario_id = $1
            ORDER BY c.criado_em DESC
        `;
            const result = await pool.query(query, [usuario_id]);

            return {
                count: result.rowCount,
                contas: result.rows
            };

        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao buscar suas contas." });
        }
    });

    app.get('/:id/:mes/:ano', { preHandler: [validarJWT] }, async (request, reply) => {
        const { id, mes, ano } = request.params as { id: string, mes: string, ano: string }

        try {
            const query = `
            SELECT * FROM transacoes 
            WHERE conta_id = $1 
                AND EXTRACT(MONTH FROM data_transacao) = $2
                AND EXTRACT(YEAR FROM data_transacao) = $3
            ORDER BY id DESC;
            `;


            const secondQuery = `
            SELECT 
                cu.*, 
                u.iniciais,
                u.nome 
            FROM conta_usuarios cu 
            LEFT JOIN usuarios u ON cu.usuario_id = u.id 
            WHERE cu.conta_id = $1;
            `

            const result = await pool.query(query, [id, mes, ano]);
            const secondResult = await pool.query(secondQuery, [id]);

            return {
                transacoes: result.rows,
                usuarios: secondResult.rows
            };

        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao buscar suas contas." });
        }
    });

    app.post('/criarconta', { preHandler: [validarJWT] }, async (request, reply) => {
        const { nome, convidado_id } = request.body as { nome: string, convidado_id?: number };
        const criado_por = request.user.id;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Cria a conta
            const queryConta = 'INSERT INTO contas (nome, criado_por) VALUES ($1, $2) RETURNING id, nome';
            const resConta = await client.query(queryConta, [nome, criado_por]);
            const novaConta = resConta.rows[0];

            // 2. Vincula o criador como 'adm' (usei 'adm' para bater com seus selects anteriores)
            const queryVinculo = `
            INSERT INTO conta_usuarios (conta_id, usuario_id, papel) 
            VALUES ($1, $2, $3)
        `;
            await client.query(queryVinculo, [novaConta.id, criado_por, 'adm']);

            // 3. SE houver convidado, cria a SOLICITAÇÃO (não o vínculo direto ainda)
            if (convidado_id) {
                // Verifica se o convidado existe para não quebrar a FK
                const userExiste = await client.query('SELECT id FROM usuarios WHERE id = $1', [convidado_id]);

                if (userExiste.rowCount && userExiste.rowCount > 0) {
                    await client.query(
                        'INSERT INTO solicitacoes (usuario_id, conta_id, convidado_por) VALUES ($1, $2, $3)',
                        [convidado_id, novaConta.id, criado_por]
                    );
                }
            }

            await client.query('COMMIT');

            return reply.code(201).send({
                message: "Conta criada! Convite enviado.",
                conta: novaConta
            });

        } catch (error) {
            await client.query('ROLLBACK');
            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao criar conta." });
        } finally {
            client.release();
        }
    });


    app.post('/:contaId/compartilhar', { preHandler: [validarJWT] }, async (request, reply) => {
        const { contaId } = request.params as { contaId: string };
        const { usuario_id, papel } = request.body as { usuario_id: number, papel: string };
        const admin_id = request.user.id;

        try {
            // Validação: Apenas ADM da conta pode convidar
            const permissao = await pool.query(
                'SELECT papel FROM conta_usuarios WHERE conta_id = $1 AND usuario_id = $2',
                [contaId, admin_id]
            );

            if (permissao.rowCount === 0 || permissao.rows[0].papel !== 'adm') {
                return reply.code(403).send({ error: "Apenas administradores podem convidar membros." });
            }

            // Criamos a SOLICITAÇÃO (Pendente)
            await pool.query(
                `INSERT INTO solicitacoes (usuario_id, conta_id, convidado_por) 
             VALUES ($1, $2, $3)`,
                [usuario_id, contaId, admin_id]
            );

            return reply.send({ message: "Convite enviado com sucesso!" });

        } catch (error: any) {
            if (error.code === '23505') {
                return reply.code(400).send({ error: "Já existe um convite pendente ou usuário já é membro." });
            }
            if (error.code === '23503') {
                return reply.code(404).send({ error: "Usuário convidado não existe." });
            }

            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao enviar convite." });
        }
    });

    app.get('/convites/pendentes', { preHandler: [validarJWT] }, async (request, reply) => {
        const usuario_id = request.user.id;

        try {
            const query = `
            SELECT 
                s.id as solicitacao_id,
                s.conta_id,
                c.nome as nome_conta,
                u.nome as convidado_por_nome
            FROM solicitacoes s
            JOIN contas c ON s.conta_id = c.id
            JOIN usuarios u ON s.convidado_por = u.id
            WHERE s.usuario_id = $1 AND s.situacao = 'pendente'
        `;
            const result = await pool.query(query, [usuario_id]);
            return reply.send(result.rows);
        } catch (error) {
            return reply.code(500).send({ error: "Erro ao buscar convites." });
        }
    });

    app.post('/convites/:id/responder', { preHandler: [validarJWT] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { aceito } = request.body as { aceito: boolean };
        const usuario_id = request.user.id;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            if (aceito) {
                // 1. Pega os dados da solicitação
                const sol = await client.query('SELECT conta_id FROM solicitacoes WHERE id = $1', [id]);

                // 2. Insere na tabela de membros
                await client.query(
                    'INSERT INTO conta_usuarios (conta_id, usuario_id, papel) VALUES ($1, $2, $3)',
                    [sol.rows[0].conta_id, usuario_id, 'leitor']
                );

                // 3. Atualiza a solicitação
                await client.query('UPDATE solicitacoes SET situacao = $1 WHERE id = $2', ['aceito', id]);
            } else {
                await client.query('UPDATE solicitacoes SET situacao = $1 WHERE id = $2', ['recusado', id]);
            }

            await client.query('COMMIT');
            return reply.send({ message: "Resposta registrada!" });
        } catch (e) {
            await client.query('ROLLBACK');
            return reply.code(500).send({ error: "Erro ao processar convite." });
        } finally {
            client.release();
        }
    });

}