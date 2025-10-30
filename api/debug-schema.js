// api/debug-schema.js
// ⚠️ DELETE THIS FILE BEFORE PRODUCTION ⚠️
const { Pool } = require('pg');

module.exports = async (req, res) => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Get all column names from users table
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    return res.status(200).json({
      success: true,
      columns: result.rows
    });

  } catch (error) {
    console.error('Schema check error:', error);
    return res.status(500).json({
      error: 'Failed to check schema',
      details: error.message
    });
  } finally {
    await pool.end();
  }
};
