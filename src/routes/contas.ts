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

    app.get('/:id/membros', { preHandler: [validarJWT] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const usuario_id = request.user.id;

        try {
            const acesso = await pool.query(
                'SELECT 1 FROM conta_usuarios WHERE conta_id = $1 AND usuario_id = $2',
                [id, usuario_id]
            );

            if (acesso.rowCount === 0) {
                return reply.code(403).send({ error: "Você não tem acesso a esta conta." });
            }

            const result = await pool.query(
                `SELECT
                    cu.*,
                    u.iniciais,
                    u.nome
                FROM conta_usuarios cu
                LEFT JOIN usuarios u ON cu.usuario_id = u.id
                WHERE cu.conta_id = $1`,
                [id]
            );

            return { usuarios: result.rows };
        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao buscar membros da conta." });
        }
    });

    app.get('/:id/:mes/:ano', { preHandler: [validarJWT] }, async (request, reply) => {
        const { id, mes, ano } = request.params as { id: string, mes: string, ano: string }
        const usuario_id = request.user.id;

        const mesNum = Number(mes);
        const anoNum = Number(ano);

        if (!Number.isInteger(mesNum) || mesNum < 1 || mesNum > 12 || !Number.isInteger(anoNum)) {
            return reply.code(400).send({ error: "Mês ou ano inválido." });
        }

        try {
            const acesso = await pool.query(
                'SELECT 1 FROM conta_usuarios WHERE conta_id = $1 AND usuario_id = $2',
                [id, usuario_id]
            );

            if (acesso.rowCount === 0) {
                return reply.code(403).send({ error: "Você não tem acesso a esta conta." });
            }

            const query = `
            SELECT * FROM transacoes
            WHERE conta_id = $1
                AND EXTRACT(MONTH FROM data_transacao) = $2
                AND EXTRACT(YEAR FROM data_transacao) = $3
            ORDER BY id DESC;
            `;

            // Saldo acumulado de tudo antes do mês selecionado, pra não zerar o saldo todo dia 1.
            const saldoAnteriorQuery = `
            SELECT COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor ELSE -valor END), 0) AS saldo
            FROM transacoes
            WHERE conta_id = $1
                AND data_transacao < make_date($2::int, $3::int, 1);
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

            const result = await pool.query(query, [id, mesNum, anoNum]);
            const saldoAnteriorResult = await pool.query(saldoAnteriorQuery, [id, anoNum, mesNum]);
            const secondResult = await pool.query(secondQuery, [id]);

            return {
                transacoes: result.rows,
                usuarios: secondResult.rows,
                saldoAnterior: Number(saldoAnteriorResult.rows[0].saldo)
            };

        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao buscar suas contas." });
        }
    });

    app.post('/criarconta', { preHandler: [validarJWT] }, async (request, reply) => {
        const { nome, convidado_id } = request.body as { nome: string, convidado_id?: number };
        const criado_por = request.user.id;

        if (!nome || !nome.trim()) {
            return reply.code(400).send({ error: "Nome da conta é obrigatório." });
        }

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

        const papelValido = ['adm', 'editor', 'leitura'].includes(papel) ? papel : 'leitura';

        try {
            // Validação: Apenas ADM da conta pode convidar
            const permissao = await pool.query(
                'SELECT papel FROM conta_usuarios WHERE conta_id = $1 AND usuario_id = $2',
                [contaId, admin_id]
            );

            if (permissao.rowCount === 0 || permissao.rows[0].papel !== 'adm') {
                return reply.code(403).send({ error: "Apenas administradores podem convidar membros." });
            }

            // Criamos a SOLICITAÇÃO (Pendente), já guardando o papel escolhido
            await pool.query(
                `INSERT INTO solicitacoes (usuario_id, conta_id, convidado_por, papel)
             VALUES ($1, $2, $3, $4)`,
                [usuario_id, contaId, admin_id, papelValido]
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

            // Só pode responder uma solicitação que seja SUA e que ainda esteja pendente.
            const sol = await client.query(
                'SELECT conta_id, papel FROM solicitacoes WHERE id = $1 AND usuario_id = $2 AND situacao = $3',
                [id, usuario_id, 'pendente']
            );

            if (sol.rowCount === 0) {
                await client.query('ROLLBACK');
                return reply.code(404).send({ error: "Convite não encontrado ou já respondido." });
            }

            if (aceito) {
                // Insere na tabela de membros com o papel que foi realmente oferecido no convite
                await client.query(
                    'INSERT INTO conta_usuarios (conta_id, usuario_id, papel) VALUES ($1, $2, $3)',
                    [sol.rows[0].conta_id, usuario_id, sol.rows[0].papel]
                );

                await client.query('UPDATE solicitacoes SET situacao = $1, respondido_em = NOW() WHERE id = $2', ['aceito', id]);
            } else {
                await client.query('UPDATE solicitacoes SET situacao = $1, respondido_em = NOW() WHERE id = $2', ['recusado', id]);
            }

            await client.query('COMMIT');
            return reply.send({ message: "Resposta registrada!" });
        } catch (e) {
            await client.query('ROLLBACK');
            app.log.error(e);
            return reply.code(500).send({ error: "Erro ao processar convite." });
        } finally {
            client.release();
        }
    });

}