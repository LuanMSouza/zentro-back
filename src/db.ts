import 'dotenv/config';
import { Pool } from 'pg';

if (!process.env.DB_URL) {
    console.error('❌ DB_URL não definida nas variáveis de ambiente.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DB_URL,
});

pool.on('error', (err) => {
    console.error('❌ Erro inesperado em cliente ocioso do pool:', err);
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Erro ao conectar no banco de dados:', err.stack);
    } else {
        console.log('✅ Banco de Dados conectado com sucesso em:', res.rows[0].now);
    }
});

export default pool;