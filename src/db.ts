import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DB_URL,
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Erro ao conectar no banco de dados:', err.stack);
    } else {
        console.log('✅ Banco de Dados conectado com sucesso em:', res.rows[0].now);
    }
});

export default pool;