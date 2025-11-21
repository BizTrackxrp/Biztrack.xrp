// api/sessions/revoke-all.js - Sign out all other sessions (except current)
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized' 
      });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid or expired token' 
      });
    }

    const userId = decoded.userId;

    // Get current token hash
    const currentTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Sign out all sessions EXCEPT the current one
    const result = await pool.query(
      `UPDATE sessions 
       SET signed_out_at = NOW() 
       WHERE user_id = $1 
         AND token_hash != $2 
         AND signed_out_at IS NULL
       RETURNING id`,
      [userId, currentTokenHash]
    );

    const revokedCount = result.rows.length;

    console.log('[SESSIONS] ✅ Revoked', revokedCount, 'other sessions for user:', userId);

    return res.status(200).json({
      success: true,
      message: `${revokedCount} other session(s) signed out successfully`,
      revokedCount: revokedCount
    });

  } catch (error) {
    console.error('[SESSIONS] ❌ Error revoking all sessions:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to revoke sessions',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
